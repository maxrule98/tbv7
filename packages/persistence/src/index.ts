/**
 * Persistence package will eventually manage trade/event storage. Placeholder
 * to allow wiring without picking a database yet.
 */
export interface PersistenceOptions {
	driver: "file" | "postgres" | "dynamo";
	connection?: string;
}

export const createPersistenceLayer = (options: PersistenceOptions) => ({
	async save(): Promise<void> {
		void options;
		// no-op placeholder
	},
});
