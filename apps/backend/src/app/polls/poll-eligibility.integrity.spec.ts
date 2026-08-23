import { PollEligibilityService } from './poll-eligibility.service';

describe('PollEligibilityService import and mutation boundaries', () => {
  it('detects a delimiter outside quoted header fields', () => {
    const service = new PollEligibilityService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(service.parseEligibilityImport({
      format: 'csv',
      selectedHeader: 'matrícula, institucional',
      content: '"matrícula, institucional";nome\n123;Ada',
    })).toMatchObject({ enrollmentNumbers: ['123'] });
  });
});
