import { BadRequestException } from '@nestjs/common';
import { PollCacicElectionSlateValidatorService } from './poll-cacic-election-slate-validator.service';

type TestMember = {
  fullName: string;
  enrollmentNumber: string;
  role: string;
  isRepresentative: boolean;
  identifierType: string;
  identifierValue: string;
};

function members(): TestMember[] {
  return [
    ['president', true],
    ['vicePresident', false],
    ['financialDirector', false],
    ['communicationDirector', false],
    ['eventsDirector', false],
    ['publicRelationsDirector', false],
  ].map(([role, isRepresentative], index) => ({
    fullName: `Member ${index}`,
    enrollmentNumber: `2612345${index}`,
    role,
    isRepresentative,
    identifierType: 'email',
    identifierValue: `member-${index}@example.com`,
  })) as TestMember[];
}

describe('PollCacicElectionSlateValidatorService', () => {
  it('rejects duplicate identifiers and invalid CPF check digits', async () => {
    const accountManager = { lookupPeopleByIdentifiers: jest.fn() };
    const service = new PollCacicElectionSlateValidatorService(accountManager as never);
    const duplicate = members();
    duplicate[1].identifierValue = duplicate[0].identifierValue;
    await expect(service.normalizeCacicElectionSlateMembers(duplicate as never)).rejects.toThrow(BadRequestException);

    const invalidCpf = members();
    invalidCpf[0].identifierType = 'cpf';
    invalidCpf[0].identifierValue = '12345678901';
    await expect(service.normalizeCacicElectionSlateMembers(invalidCpf as never)).rejects.toThrow('CPF is invalid');
  });

  it('requires exactly one matching Account Manager person per member', async () => {
    const accountManager = {
      lookupPeopleByIdentifiers: jest.fn().mockResolvedValue(new Map()),
    };
    const service = new PollCacicElectionSlateValidatorService(accountManager as never);
    await expect(service.normalizeCacicElectionSlateMembers(members() as never)).rejects.toThrow('exactly one Account Manager');
  });
});
