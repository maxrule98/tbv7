import http from "http";
import { startTrader } from "@agenai/trader-runtime";

const main = async (): Promise<void> => {
	console.info("Starting AgenAI Trader Server...");

	startTrader({
		symbol: "BTC/USDT",
		timeframe: "1m",
		useTestnet: false,
	}).catch((error) => {
		console.error("Trader runtime failed:", error);
		process.exit(1);
	});

	const port = Number(process.env.PORT) || 3000;
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok" }));
	});

	server.listen(port, () => {
		console.info(`HTTP health server listening on port ${port}`);
	});
};

main().catch((error) => {
	console.error("Fatal error in trader-server:", error);
	process.exit(1);
});
