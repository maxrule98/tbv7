"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionEngine = exports.PaperAccount = void 0;
var paperAccount_1 = require("./paperAccount");
Object.defineProperty(exports, "PaperAccount", { enumerable: true, get: function () { return paperAccount_1.PaperAccount; } });
class ExecutionEngine {
    constructor(options) {
        this.options = options;
        this.paperPositions = new Map();
        this.mode = options.mode ?? "paper";
        this.paperAccount = options.paperAccount;
    }
    getPosition(symbol) {
        return { ...this.ensurePaperPosition(symbol) };
    }
    getPaperPosition(symbol) {
        return this.getPosition(symbol);
    }
    updatePosition(symbol, updates) {
        const position = this.ensurePaperPosition(symbol);
        Object.assign(position, updates);
        return { ...position };
    }
    async execute(plan, context) {
        if (this.mode === "paper") {
            return this.handlePaperExecution(plan, context);
        }
        const order = await this.options.client.createMarketOrder(plan.symbol, plan.side, plan.quantity);
        return {
            symbol: plan.symbol,
            side: plan.side,
            quantity: plan.quantity,
            status: "submitted",
            price: order?.average ?? order?.price ?? context.price ?? null,
            mode: this.mode,
        };
    }
    hasPaperAccount() {
        return Boolean(this.paperAccount);
    }
    snapshotPaperAccount(unrealizedPnl) {
        if (!this.paperAccount) {
            return null;
        }
        return this.paperAccount.snapshot(unrealizedPnl);
    }
    handlePaperExecution(plan, context) {
        const position = this.ensurePaperPosition(plan.symbol);
        const fillPrice = context.price;
        if (plan.side === "buy") {
            position.side = "LONG";
            position.size = plan.quantity;
            position.avgEntryPrice = fillPrice;
            position.entryPrice = fillPrice;
            position.peakPrice = fillPrice;
            position.trailingStopPrice = plan.stopLossPrice;
            position.isTrailingActive = false;
            position.stopLossPrice = plan.stopLossPrice;
            position.takeProfitPrice = plan.takeProfitPrice;
            return {
                symbol: plan.symbol,
                side: plan.side,
                quantity: plan.quantity,
                status: "paper_filled",
                price: fillPrice,
                mode: this.mode,
                totalRealizedPnl: position.realizedPnl,
            };
        }
        if (position.side !== "LONG" ||
            position.size <= 0 ||
            position.avgEntryPrice === null) {
            return {
                symbol: plan.symbol,
                side: plan.side,
                quantity: 0,
                status: "skipped",
                price: fillPrice,
                mode: this.mode,
                reason: "no_long_to_close",
            };
        }
        const closedQuantity = position.size;
        const entryPrice = position.avgEntryPrice;
        const realizedPnl = (fillPrice - entryPrice) * closedQuantity;
        position.realizedPnl += realizedPnl;
        if (this.paperAccount) {
            const closedTrade = {
                symbol: plan.symbol,
                side: "LONG",
                size: closedQuantity,
                entryPrice,
                exitPrice: fillPrice,
                realizedPnl,
                timestamp: new Date().toISOString(),
            };
            const snapshot = this.paperAccount.registerClosedTrade(closedTrade);
            this.logPaperAccountUpdate(plan.symbol, snapshot);
        }
        position.side = "FLAT";
        position.size = 0;
        position.avgEntryPrice = null;
        position.entryPrice = 0;
        position.peakPrice = 0;
        position.trailingStopPrice = 0;
        position.isTrailingActive = false;
        position.stopLossPrice = undefined;
        position.takeProfitPrice = undefined;
        return {
            symbol: plan.symbol,
            side: plan.side,
            quantity: closedQuantity,
            status: "paper_closed",
            price: fillPrice,
            mode: this.mode,
            realizedPnl,
            totalRealizedPnl: position.realizedPnl,
        };
    }
    ensurePaperPosition(symbol) {
        if (!this.paperPositions.has(symbol)) {
            this.paperPositions.set(symbol, {
                side: "FLAT",
                size: 0,
                avgEntryPrice: null,
                realizedPnl: 0,
                entryPrice: 0,
                peakPrice: 0,
                trailingStopPrice: 0,
                isTrailingActive: false,
                stopLossPrice: undefined,
                takeProfitPrice: undefined,
            });
        }
        return this.paperPositions.get(symbol);
    }
    logPaperAccountUpdate(symbol, snapshot) {
        console.log(JSON.stringify({
            event: "paper_account_update",
            symbol,
            snapshot,
        }));
    }
}
exports.ExecutionEngine = ExecutionEngine;
