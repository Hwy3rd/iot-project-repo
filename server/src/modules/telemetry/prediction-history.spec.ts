import { samplePredictionHistory } from './prediction-history';

const asOf = new Date('2026-10-04T10:00:00Z');
const denseRows = () =>
  Array.from({ length: 733 }, (_, i) => ({
    ts: new Date(asOf.getTime() - i * 5000),
    temperature: -18 + i / 1000,
  }));

describe('samplePredictionHistory', () => {
  it('samples by elapsed time from five-second firmware readings, oldest first', () => {
    const selected = samplePredictionHistory(denseRows(), asOf, -18)!;
    expect(selected).toHaveLength(13);
    expect(selected[0]).toEqual({
      ts: new Date(asOf.getTime() - 3_600_000).toISOString(),
      temperature: -17.28,
    });
    expect(selected[12]).toEqual({ ts: asOf.toISOString(), temperature: -18 });
    expect(selected[11].temperature).toBe(-17.94);
  });

  it('chooses only past values and retains their actual timestamps with jitter', () => {
    const rows = denseRows().filter((_, i) => i !== 60);
    rows.unshift({ ts: new Date(asOf.getTime() + 5000), temperature: 19 });
    const selected = samplePredictionHistory(rows, asOf, -18)!;
    expect(selected[11]).toEqual({
      ts: new Date(asOf.getTime() - 305_000).toISOString(),
      temperature: -17.939,
    });
    expect(selected[12].temperature).toBe(-18);
  });

  it('accepts exactly 60 seconds of staleness but rejects a larger gap', () => {
    const rows = denseRows().filter((_, i) => i < 60 || i >= 72);
    expect(samplePredictionHistory(rows, asOf, -18)).not.toBeNull();
    expect(
      samplePredictionHistory(
        rows.filter((_, i) => i !== 60),
        asOf,
        -18,
      ),
    ).toBeNull();
  });

  it('rejects missing history, invalid values, and a mismatched current reading', () => {
    expect(
      samplePredictionHistory(denseRows().slice(0, 13), asOf, -18),
    ).toBeNull();
    expect(samplePredictionHistory(denseRows(), asOf, -17)).toBeNull();
    const invalid = denseRows().map((row) => ({ ...row, temperature: NaN }));
    expect(samplePredictionHistory(invalid, asOf, -18)).toBeNull();
    expect(samplePredictionHistory([], asOf, -18)).toBeNull();
  });
});
