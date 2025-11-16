"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@agenai/core");
const exchange_binance_1 = require("@agenai/exchange-binance");
const indicators_1 = require("@agenai/indicators");
const models_quant_1 = require("@agenai/models-quant");
const strategy_engine_1 = require("@agenai/strategy-engine");
const risk_engine_1 = require("@agenai/risk-engine");
const execution_engine_1 = require("@agenai/execution-engine");
async function main() {
    const [strategyConfig, riskConfig] = await Promise.all([
        core_1.Config.strategy('macd_ar4'),
        core_1.Config.risk('default')
    ]);
    const exchange = await exchange_binance_1.BinanceExchangeClient.create('binance');
    const executionEngine = new execution_engine_1.ExecutionEngine(exchange);
    const strategyEngine = new strategy_engine_1.StrategyEngine(strategyConfig);
    const riskEngine = new risk_engine_1.RiskEngine(riskConfig);
    const symbol = strategyConfig.symbol;
    const candles = await exchange.fetchOHLCV({
        symbol,
        timeframe: strategyConfig.timeframe,
        limit: 500
    });
    if (candles.length === 0) {
        console.warn('No candle data available');
        return;
    }
    const closes = candles.map((candle) => candle.close);
    const emaFast = (0, indicators_1.emaSeries)(closes, strategyConfig.indicators.emaFast);
    const emaSlow = (0, indicators_1.emaSeries)(closes, strategyConfig.indicators.emaSlow);
    const macd = (0, indicators_1.macdSeries)(closes, {
        fastPeriod: strategyConfig.indicators.emaFast,
        slowPeriod: strategyConfig.indicators.emaSlow,
        signalPeriod: strategyConfig.indicators.signal
    });
    const rsi = (0, indicators_1.rsiSeries)(closes);
    const ar4 = (0, models_quant_1.computeAr4Forecast)(closes);
    const indicatorSnapshot = {
        emaFast: last(emaFast),
        emaSlow: last(emaSlow),
        macdLine: last(macd.macd),
        macdSignal: last(macd.signal),
        macdHistogram: last(macd.histogram),
        rsi: last(rsi),
        macdLineSeries: macd.macd,
        macdSignalSeries: macd.signal,
        macdHistogramSeries: macd.histogram,
        rsiSeries: rsi
    };
    const positions = await exchange.fetchPositions(symbol);
    const currentPosition = positions[0];
    const intent = strategyEngine.evaluate({
        indicators: indicatorSnapshot,
        forecast: { ar4: ar4?.forecast },
        currentPositionSide: currentPosition?.side
    });
    console.log('Strategy intent:', intent);
    if (intent.action === core_1.StrategyAction.NO_ACTION) {
        return;
    }
    const accountState = await exchange.fetchBalance();
    const lastPrice = closes[closes.length - 1];
    const riskAssessment = riskEngine.evaluate(intent, accountState, symbol, lastPrice);
    if (!riskAssessment.shouldTrade || !riskAssessment.plan) {
        console.log('Risk rejected trade:', riskAssessment.reason);
        return;
    }
    const report = await executionEngine.execute(riskAssessment.plan);
    console.log('Execution report:', report);
}
function last(values) {
    return values[values.length - 1];
}
main().catch((error) => {
    console.error('Trader CLI failed:', error);
    process.exit(1);
});
