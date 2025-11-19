"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MexcClient = void 0;
const ccxt_1 = __importDefault(require("ccxt"));
class MexcClient {
    constructor(options = {}) {
        this.marketsLoaded = false;
        this.exchange = new ccxt_1.default.mexc({
            apiKey: options.apiKey,
            secret: options.secret,
            enableRateLimit: true,
            options: {
                defaultType: options.useFutures === false ? "spot" : "swap",
                defaultSubType: "linear",
            },
        });
    }
    async fetchOHLCV(symbol, timeframe, limit = 500) {
        const marketSymbol = await this.resolveMarketSymbol(symbol);
        const ohlcv = await this.exchange.fetchOHLCV(marketSymbol, timeframe, undefined, limit);
        return ohlcv.map((row) => MexcClient.mapCandle(row, symbol, timeframe));
    }
    async createMarketOrder(symbol, side, amount) {
        const marketSymbol = await this.resolveMarketSymbol(symbol);
        return this.exchange.createOrder(marketSymbol, "market", side, amount);
    }
    async getBalanceUSDT() {
        const rawBalance = (await this.exchange.fetchBalance());
        const total = (rawBalance.total ?? {});
        const free = (rawBalance.free ?? {});
        return Number(total.USDT ?? free.USDT ?? 0);
    }
    async getPosition(symbol) {
        const marketSymbol = await this.resolveMarketSymbol(symbol);
        try {
            const positions = (await this.exchange.fetchPositions([
                marketSymbol,
            ]));
            const match = positions.find((position) => position.symbol === marketSymbol);
            if (!match) {
                return MexcClient.emptyPosition();
            }
            const contracts = Number(match.contracts ?? match.info?.vol ?? match.info?.availableVol ?? 0);
            if (!contracts) {
                return MexcClient.emptyPosition();
            }
            const side = contracts > 0 ? "LONG" : "SHORT";
            const normalizedEntry = match.entryPrice ??
                Number(match.info?.avgEntryPrice ?? match.info?.entryPrice ?? NaN);
            const normalizedPnl = match.unrealizedPnl ??
                Number(match.info?.unrealizedPnl ?? match.info?.unRealizedProfit ?? NaN);
            return {
                side,
                size: Math.abs(contracts),
                entryPrice: Number.isFinite(normalizedEntry ?? NaN)
                    ? normalizedEntry
                    : null,
                unrealizedPnl: Number.isFinite(normalizedPnl ?? NaN)
                    ? normalizedPnl
                    : null,
            };
        }
        catch (error) {
            console.warn("MexcClient.getPosition failed", error);
            return MexcClient.emptyPosition();
        }
    }
    async resolveMarketSymbol(symbol) {
        await this.ensureMarketsLoaded();
        try {
            return this.exchange.market(symbol).symbol;
        }
        catch (error) {
            const linearSymbol = `${symbol}:USDT`;
            const market = this.exchange.markets?.[linearSymbol];
            if (market) {
                return market.symbol;
            }
            throw new Error(`Unknown MEXC market symbol for ${symbol}`);
        }
    }
    async ensureMarketsLoaded() {
        if (this.marketsLoaded) {
            return;
        }
        await this.exchange.loadMarkets();
        this.marketsLoaded = true;
    }
    static mapCandle(row, symbol, timeframe) {
        const [timestamp, open, high, low, close, volume] = row;
        return {
            symbol,
            timeframe,
            timestamp: Number(timestamp ?? 0),
            open: Number(open ?? 0),
            high: Number(high ?? 0),
            low: Number(low ?? 0),
            close: Number(close ?? 0),
            volume: Number(volume ?? 0),
        };
    }
    static emptyPosition() {
        return {
            side: "FLAT",
            size: 0,
            entryPrice: null,
            unrealizedPnl: null,
        };
    }
}
exports.MexcClient = MexcClient;
