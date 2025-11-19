"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaperAccount = void 0;
class PaperAccount {
    constructor(startingBalance) {
        this.startingBalance = startingBalance;
        this.balance = startingBalance;
        this.equity = startingBalance;
        this.maxEquity = startingBalance;
        this.trades = {
            total: 0,
            wins: 0,
            losses: 0,
            breakeven: 0,
        };
    }
    registerClosedTrade(trade) {
        this.balance += trade.realizedPnl;
        this.trades.total += 1;
        if (trade.realizedPnl > 0) {
            this.trades.wins += 1;
        }
        else if (trade.realizedPnl < 0) {
            this.trades.losses += 1;
        }
        else {
            this.trades.breakeven += 1;
        }
        this.lastTrade = trade;
        return this.snapshot(0);
    }
    snapshot(unrealizedPnl) {
        this.equity = this.balance + unrealizedPnl;
        if (this.equity > this.maxEquity) {
            this.maxEquity = this.equity;
        }
        const maxDrawdown = this.maxEquity - this.equity;
        return {
            startingBalance: this.startingBalance,
            balance: this.balance,
            equity: this.equity,
            totalRealizedPnl: this.balance - this.startingBalance,
            maxEquity: this.maxEquity,
            maxDrawdown,
            trades: { ...this.trades },
            lastTrade: this.lastTrade,
        };
    }
}
exports.PaperAccount = PaperAccount;
