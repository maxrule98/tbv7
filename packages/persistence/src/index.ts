/**
 * Persistence package will eventually manage trade/event storage. Placeholder
 * to allow wiring without picking a database yet.
 */
export interface PersistenceOptions {
  driver: 'file' | 'postgres' | 'dynamo';
  connection?: string;
}

export const createPersistenceLayer = (_options: PersistenceOptions) => ({
  async save(): Promise<void> {
    // no-op placeholder
  }
});
