import { DataSource } from 'typeorm';
import { ChatbotDocuments1793577600000 } from '../../../database/migrations/1793577600000-ChatbotDocuments';
import { ChatbotDocument } from './chatbot-document.entity';

// Build MySQL metadata without connecting to any database.
class MetadataSource extends DataSource {
  async metadataOnly() {
    await this.buildMetadatas();
  }
}
describe('Chatbot document schema', () => {
  it('keeps the migration aligned with the entity and content deduplication index', async () => {
    const source = new MetadataSource({
      type: 'mysql',
      database: 'metadata_only',
      entities: [ChatbotDocument],
    });
    await source.metadataOnly();
    const metadata = source.getMetadata(ChatbotDocument);
    const query = jest.fn<Promise<void>, [string]>().mockResolvedValue();
    await new ChatbotDocuments1793577600000().up({ query } as never);
    const sql = query.mock.calls[0][0];
    for (const column of metadata.columns)
      expect(sql).toContain(`\`${column.databaseName}\``);
    const unique = metadata.indices.filter((index) => index.isUnique);
    expect(unique).toHaveLength(1);
    expect(unique[0].columns.map((column) => column.databaseName)).toEqual([
      'content_hash',
    ]);
    expect(sql).toContain(`UNIQUE INDEX \`${unique[0].name}\``);
    expect(
      metadata.columns
        .filter((column) => !column.isSelect)
        .map((column) => column.databaseName),
    ).toEqual(['job_token', 'text_content', 'embedding_data']);
  });
});
