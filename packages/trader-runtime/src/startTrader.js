"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTrader = exports.DEFAULT_POLL_INTERVAL_MS = void 0;
const core_1 = require("@agenai/core");
const exchange_mexc_1 = require("@agenai/exchange-mexc");
const execution_engine_1 = require("@agenai/execution-engine");
const risk_engine_1 = require("@agenai/risk-engine");
const strategy_engine_1 = require("@agenai/strategy-engine");
exports.DEFAULT_POLL_INTERVAL_MS = 10000;
const startTrader = async (traderConfig, options = {}) => {
    const agenaiConfig = options.agenaiConfig ??
        (0, core_1.loadAgenaiConfig)({
            envPath: options.envPath,
            configDir: options.configDir,
            exchangeProfile: options.exchangeProfile,
            strategyProfile: options.strategyProfile,
            riskProfile: options.riskProfile,
        });
    const accountConfig = options.accountConfig ??
        (0, core_1.loadAccountConfig)(options.configDir, options.accountProfile ?? "paper");
    const executionMode = traderConfig.executionMode ?? agenaiConfig.env.executionMode ?? "paper";
    const client = new exchange_mexc_1.MexcClient({
        apiKey: agenaiConfig.exchange.credentials.apiKey,
        secret: agenaiConfig.exchange.credentials.apiSecret,
        useFutures: true,
    });
    const strategy = new strategy_engine_1.MacdAr4Strategy({
        emaFast: 12,
        emaSlow: 26,
        signal: 9,
        arWindow: 20,
        minForecast: 0,
    });
    const riskManager = new risk_engine_1.RiskManager(agenaiConfig.risk);
    const paperAccount = executionMode === "paper"
        ? new execution_engine_1.PaperAccount(accountConfig.startingBalance)
        : undefined;
    const executionEngine = new execution_engine_1.ExecutionEngine({
        client,
        mode: executionMode,
        paperAccount,
    });
    const initialEquity = paperAccount
        ? paperAccount.snapshot(0).equity
        : accountConfig.startingBalance || 100;
    console.info(JSON.stringify({
        symbol: traderConfig.symbol,
        timeframe: traderConfig.timeframe,
        useTestnet: traderConfig.useTestnet,
    }));
    logRiskConfig(agenaiConfig.risk);
    const candlesBySymbol = new Map();
    const lastTimestampBySymbol = new Map();
    await bootstrapCandles(client, traderConfig.symbol, traderConfig.timeframe, candlesBySymbol, lastTimestampBySymbol);
    return startPolling(client, strategy, riskManager, agenaiConfig.risk, executionEngine, initialEquity, traderConfig.symbol, traderConfig.timeframe, candlesBySymbol, lastTimestampBySymbol, traderConfig.pollIntervalMs ?? exports.DEFAULT_POLL_INTERVAL_MS);
};
exports.startTrader = startTrader;
const logRiskConfig = (risk) => {
    console.log(JSON.stringify({
        event: "risk_config",
        riskPerTradePercent: risk.riskPerTradePercent,
        minPositionSize: risk.minPositionSize,
        maxPositionSize: risk.maxPositionSize,
        slPct: risk.slPct,
        tpPct: risk.tpPct,
        trailingActivationPct: risk.trailingActivationPct,
        trailingTrailPct: risk.trailingTrailPct,
    }));
};
const bootstrapCandles = async (client, symbol, timeframe, candlesBySymbol, lastTimestampBySymbol) => {
    try {
        const candles = await client.fetchOHLCV(symbol, timeframe, 300);
        if (!candles.length) {
            console.warn("Bootstrap fetch returned no candles for", symbol);
            return;
        }
        candlesBySymbol.set(symbol, candles);
        lastTimestampBySymbol.set(symbol, candles[candles.length - 1]?.timestamp ?? 0);
        console.info(`Bootstrapped ${candles.length} candles for ${symbol}`);
    }
    catch (error) {
        logMarketDataError(error);
    }
};
const startPolling = async (client, strategy, riskManager, riskConfig, executionEngine, defaultEquity, symbol, timeframe, candlesBySymbol, lastTimestampBySymbol, pollIntervalMs) => {
    let fallbackEquity = defaultEquity;
    while (true) {
        let latest;
        try {
            const candles = await client.fetchOHLCV(symbol, timeframe, 1);
            const latestRaw = candles[candles.length - 1];
            if (!latestRaw) {
                console.warn("No candle data returned for", symbol);
            }
            else {
                latest = latestRaw;
            }
        }
        catch (error) {
            logMarketDataError(error);
        }
        if (latest) {
            const lastTimestamp = lastTimestampBySymbol.get(symbol);
            if (lastTimestamp !== latest.timestamp) {
                lastTimestampBySymbol.set(symbol, latest.timestamp);
                const buffer = appendCandle(candlesBySymbol, latest);
                logCandle(latest);
                const positionState = executionEngine.getPosition(symbol);
                const unrealizedPnl = calculateUnrealizedPnl(positionState, latest.close);
                const prePlanSnapshot = executionEngine.snapshotPaperAccount(unrealizedPnl);
                const accountEquity = prePlanSnapshot?.equity ?? fallbackEquity;
                const forcedExitHandled = await maybeHandleForcedExit(positionState, latest, riskManager, executionEngine, accountEquity);
                if (forcedExitHandled) {
                    const accountSnapshot = logAndSnapshotPosition(executionEngine, symbol, latest.close, latest.timestamp);
                    if (accountSnapshot) {
                        fallbackEquity = accountSnapshot.equity;
                    }
                    await delay(pollIntervalMs);
                    continue;
                }
                const trailingExitHandled = await maybeHandleTrailingStop(symbol, positionState, latest, riskManager, executionEngine, accountEquity, riskConfig);
                if (trailingExitHandled) {
                    const accountSnapshot = logAndSnapshotPosition(executionEngine, symbol, latest.close, latest.timestamp);
                    if (accountSnapshot) {
                        fallbackEquity = accountSnapshot.equity;
                    }
                    await delay(pollIntervalMs);
                    continue;
                }
                const intent = strategy.decide(buffer, positionState.side);
                logStrategyDecision(latest, intent);
                if (intent.intent === "OPEN_LONG" || intent.intent === "CLOSE_LONG") {
                    const plan = riskManager.plan(intent, latest.close, accountEquity, positionState.size);
                    if (!plan) {
                        logExecutionSkipped(intent, positionState.side, intent.intent === "CLOSE_LONG"
                            ? "no_position_to_close"
                            : "risk_plan_rejected");
                    }
                    else {
                        const skipReason = getPreExecutionSkipReason(plan, positionState);
                        if (skipReason) {
                            logExecutionSkipped(plan, positionState.side, skipReason);
                        }
                        else {
                            logTradePlan(plan, latest);
                            try {
                                const result = await executionEngine.execute(plan, {
                                    price: latest.close,
                                });
                                if (result.status === "skipped") {
                                    logExecutionSkipped(plan, positionState.side, result.reason ?? "execution_engine_skip");
                                }
                                else {
                                    logExecutionResult(result);
                                }
                            }
                            catch (error) {
                                logExecutionError(error, plan);
                            }
                        }
                    }
                }
                const latestPosition = executionEngine.getPosition(symbol);
                logPaperPosition(symbol, latestPosition);
                const accountSnapshot = snapshotPaperAccount(executionEngine, calculateUnrealizedPnl(latestPosition, latest.close), symbol, latest.timestamp);
                if (accountSnapshot) {
                    fallbackEquity = accountSnapshot.equity;
                }
            }
            else {
                console.info("No new candle yet for", symbol);
            }
        }
        await delay(pollIntervalMs);
    }
};
const maybeHandleForcedExit = async (positionState, lastCandle, riskManager, executionEngine, accountEquity) => {
    if (positionState.side !== "LONG" || positionState.size <= 0) {
        return false;
    }
    const stopLossPrice = positionState.stopLossPrice;
    const takeProfitPrice = positionState.takeProfitPrice;
    const hitSL = typeof stopLossPrice === "number" && lastCandle.low <= stopLossPrice;
    const hitTP = typeof takeProfitPrice === "number" && lastCandle.high >= takeProfitPrice;
    if (!hitSL && !hitTP) {
        return false;
    }
    const reason = hitSL ? "stop_loss_hit" : "take_profit_hit";
    const forcedIntent = {
        symbol: lastCandle.symbol,
        intent: "CLOSE_LONG",
        reason,
        timestamp: lastCandle.timestamp,
    };
    console.log(JSON.stringify({
        event: "strategy_decision",
        symbol: lastCandle.symbol,
        timestamp: new Date(lastCandle.timestamp).toISOString(),
        close: lastCandle.close,
        intent: "CLOSE_LONG",
        reason,
    }));
    const plan = riskManager.plan(forcedIntent, lastCandle.close, accountEquity, positionState.size);
    if (!plan) {
        logExecutionSkipped(forcedIntent, positionState.side, "forced_exit_plan_rejected");
        return true;
    }
    const skipReason = getPreExecutionSkipReason(plan, positionState);
    if (skipReason) {
        logExecutionSkipped(plan, positionState.side, skipReason);
        return true;
    }
    logTradePlan(plan, lastCandle);
    try {
        const result = await executionEngine.execute(plan, {
            price: lastCandle.close,
        });
        if (result.status === "skipped") {
            logExecutionSkipped(plan, positionState.side, result.reason ?? "execution_engine_skip");
        }
        else {
            logExecutionResult(result);
        }
    }
    catch (error) {
        logExecutionError(error, plan);
    }
    return true;
};
const maybeHandleTrailingStop = async (symbol, positionState, lastCandle, riskManager, executionEngine, accountEquity, riskConfig) => {
    if (positionState.side !== "LONG" || positionState.size <= 0) {
        return false;
    }
    const entryPrice = positionState.entryPrice > 0
        ? positionState.entryPrice
        : positionState.avgEntryPrice ?? 0;
    if (entryPrice <= 0) {
        return false;
    }
    const activationPct = Math.max(riskConfig.trailingActivationPct ?? 0, 0);
    const trailPct = Math.max(riskConfig.trailingTrailPct ?? 0, 0);
    if (trailPct <= 0) {
        return false;
    }
    let isTrailingActive = positionState.isTrailingActive;
    let peakPrice = positionState.peakPrice > 0 ? positionState.peakPrice : entryPrice;
    let trailingStopPrice = positionState.trailingStopPrice > 0
        ? positionState.trailingStopPrice
        : positionState.stopLossPrice ?? 0;
    const updates = {};
    if (!isTrailingActive &&
        lastCandle.close >= entryPrice * (1 + activationPct)) {
        isTrailingActive = true;
        updates.isTrailingActive = true;
    }
    if (!isTrailingActive) {
        if (Object.keys(updates).length) {
            executionEngine.updatePosition(symbol, updates);
        }
        return false;
    }
    peakPrice = Math.max(peakPrice, lastCandle.high);
    const proposedTrailing = peakPrice * (1 - trailPct);
    if (peakPrice !== positionState.peakPrice) {
        updates.peakPrice = peakPrice;
    }
    if (proposedTrailing > trailingStopPrice) {
        trailingStopPrice = proposedTrailing;
        updates.trailingStopPrice = trailingStopPrice;
    }
    if (Object.keys(updates).length) {
        executionEngine.updatePosition(symbol, updates);
    }
    if (trailingStopPrice <= 0 || lastCandle.low > trailingStopPrice) {
        return false;
    }
    console.log(JSON.stringify({
        event: "strategy_decision",
        intent: "CLOSE_LONG",
        reason: "trailing_stop_hit",
    }));
    const forcedIntent = {
        symbol,
        intent: "CLOSE_LONG",
        reason: "trailing_stop_hit",
        timestamp: lastCandle.timestamp,
    };
    const plan = riskManager.plan(forcedIntent, lastCandle.close, accountEquity, positionState.size);
    if (!plan) {
        logExecutionSkipped(forcedIntent, positionState.side, "trailing_exit_plan_rejected");
        return true;
    }
    const skipReason = getPreExecutionSkipReason(plan, positionState);
    if (skipReason) {
        logExecutionSkipped(plan, positionState.side, skipReason);
        return true;
    }
    logTradePlan(plan, lastCandle);
    try {
        const result = await executionEngine.execute(plan, {
            price: lastCandle.close,
        });
        if (result.status === "skipped") {
            logExecutionSkipped(plan, positionState.side, result.reason ?? "execution_engine_skip");
        }
        else {
            logExecutionResult(result);
        }
    }
    catch (error) {
        logExecutionError(error, plan);
    }
    return true;
};
const appendCandle = (candlesBySymbol, candle) => {
    const buffer = candlesBySymbol.get(candle.symbol) ?? [];
    buffer.push(candle);
    if (buffer.length > 500) {
        buffer.splice(0, buffer.length - 500);
    }
    candlesBySymbol.set(candle.symbol, buffer);
    return buffer;
};
const logCandle = (candle) => {
    const payload = {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        timestamp: new Date(candle.timestamp).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
    };
    console.info("Latest candle:", payload);
};
const logStrategyDecision = (candle, intent) => {
    console.log(JSON.stringify({
        event: "strategy_decision",
        symbol: candle.symbol,
        timestamp: new Date(candle.timestamp).toISOString(),
        close: candle.close,
        intent: intent.intent,
        reason: intent.reason,
    }));
};
const logTradePlan = (plan, candle) => {
    console.log(JSON.stringify({
        event: "trade_plan",
        symbol: plan.symbol,
        timestamp: new Date(candle.timestamp).toISOString(),
        intent: plan.reason,
        side: plan.side,
        quantity: plan.quantity,
        stopLossPrice: plan.stopLossPrice,
        takeProfitPrice: plan.takeProfitPrice,
    }));
};
const logExecutionResult = (result) => {
    const payload = {
        event: result.mode === "paper" ? "paper_execution_result" : "execution_result",
        symbol: result.symbol,
        side: result.side,
        quantity: result.quantity,
        price: result.price,
        status: result.status,
    };
    if (typeof result.realizedPnl === "number") {
        payload.realizedPnl = result.realizedPnl;
    }
    if (typeof result.totalRealizedPnl === "number") {
        payload.totalRealizedPnl = result.totalRealizedPnl;
    }
    console.log(JSON.stringify(payload));
};
const logExecutionError = (error, plan) => {
    console.error(JSON.stringify({
        event: "execution_error",
        symbol: plan.symbol,
        side: plan.side,
        quantity: plan.quantity,
        message: error instanceof Error ? error.message : String(error),
    }));
};
const logMarketDataError = (error) => {
    console.error(JSON.stringify({
        event: "market_data_error",
        message: error instanceof Error ? error.message : String(error),
    }));
};
const logExecutionSkipped = (planOrIntent, positionSide, reason) => {
    console.log(JSON.stringify({
        event: "execution_skipped",
        symbol: planOrIntent.symbol,
        side: "side" in planOrIntent ? planOrIntent.side : planOrIntent.intent,
        positionSide,
        reason,
    }));
};
const getPreExecutionSkipReason = (plan, positionState) => {
    if (plan.side === "buy" && positionState.side === "LONG") {
        return "already_long";
    }
    if (plan.side === "sell" && positionState.side === "FLAT") {
        return "already_flat";
    }
    return null;
};
const logPaperPosition = (symbol, position) => {
    console.log(JSON.stringify({
        event: "paper_position",
        symbol,
        side: position.side,
        size: position.size,
        avgEntryPrice: position.avgEntryPrice,
        realizedPnl: position.realizedPnl,
        stopLossPrice: position.stopLossPrice,
        takeProfitPrice: position.takeProfitPrice,
        entryPrice: position.entryPrice,
        peakPrice: position.peakPrice,
        trailingStopPrice: position.trailingStopPrice,
        isTrailingActive: position.isTrailingActive,
    }));
};
const snapshotPaperAccount = (executionEngine, unrealizedPnl, symbol, timestamp) => {
    const snapshot = executionEngine.snapshotPaperAccount(unrealizedPnl);
    if (!snapshot) {
        return null;
    }
    logPaperAccountSnapshot(symbol, timestamp, snapshot);
    return snapshot;
};
const logAndSnapshotPosition = (executionEngine, symbol, price, timestamp) => {
    const latestPosition = executionEngine.getPosition(symbol);
    logPaperPosition(symbol, latestPosition);
    return snapshotPaperAccount(executionEngine, calculateUnrealizedPnl(latestPosition, price), symbol, timestamp);
};
const logPaperAccountSnapshot = (symbol, timestamp, snapshot) => {
    console.log(JSON.stringify({
        event: "paper_account_snapshot",
        symbol,
        timestamp: new Date(timestamp).toISOString(),
        snapshot,
    }));
};
const calculateUnrealizedPnl = (position, price) => {
    if (position.side !== "LONG" || position.avgEntryPrice === null) {
        return 0;
    }
    return (price - position.avgEntryPrice) * position.size;
};
const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
