import { PillarService } from './pillar.service';

describe('PillarService.classify', () => {
  const service = new PillarService({} as never, {
    pillarWeights: () => ({
      engineering: 0.4,
      build_in_public: 0.3,
      product: 0.2,
      personal: 0.1,
    }),
  } as never);

  it('detects build in public', () => {
    expect(
      service.classify({
        title: 'Shipped v2 of my open source project',
        summary: 'building in public this week',
      }),
    ).toBe('build_in_public');
  });

  it('defaults to engineering', () => {
    expect(
      service.classify({
        title: 'Postgres vacuum tips for Nest APIs',
        summary: 'index bloat and query plans',
      }),
    ).toBe('engineering');
  });
});
