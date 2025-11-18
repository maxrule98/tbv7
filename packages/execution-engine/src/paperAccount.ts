export interface ClosedTrade {
	symbol: string;
	side: "LONG" | "SHORT";
	size: number;
	entryPrice: number;
	exitPrice: number;
	realizedPnl: number;
	timestamp: string;
}

export interface PaperAccountSnapshot {
	startingBalance: number;
	balance: number;
	equity: number;
	totalRealizedPnl: number;
	maxEquity: number;
	maxDrawdown: number;
	trades: {
		total: number;
		wins: number;
		losses: number;
		breakeven: number;
	};
	lastTrade?: ClosedTrade;
}

export class PaperAccount {
	private readonly startingBalance: number;
	private balance: number;
	private equity: number;
	private maxEquity: number;
	private trades: {
		total: number;
		wins: number;
		losses: number;
		breakeven: number;
	};
	private lastTrade?: ClosedTrade;

	constructor(startingBalance: number) {
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

	registerClosedTrade(trade: ClosedTrade): PaperAccountSnapshot {
		this.balance += trade.realizedPnl;
		this.trades.total += 1;

		if (trade.realizedPnl > 0) {
			this.trades.wins += 1;
		} else if (trade.realizedPnl < 0) {
			this.trades.losses += 1;
		} else {
			this.trades.breakeven += 1;
		}

		this.lastTrade = trade;

		return this.snapshot(0);
	}

	snapshot(unrealizedPnl: number): PaperAccountSnapshot {
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
