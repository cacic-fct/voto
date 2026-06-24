import {
  POLL_VOTER_ELIGIBILITY_SOURCES,
  POLL_VOTING_STYLES,
  PollVoterEligibilitySource,
} from '@org/voting-contracts';
import { describe, expect, it } from 'vitest';
import {
  VOTER_ELIGIBILITY_METADATA,
  VOTING_STYLE_METADATA,
  requiresLinkedEventEligibilitySource,
  supportsVerifiedUnespRoleRequirement,
  voterEligibilityDescription,
  voterEligibilityLabel,
  voterEligibilityOptions,
  votingStyleLabel,
  votingStyleOptions,
  votingStyleVoterDescription,
} from './poll-metadata';

describe('poll metadata helpers', () => {
  it('exposes labels and descriptions for every voting style', () => {
    expect(votingStyleOptions.map((option) => option.style)).toEqual(POLL_VOTING_STYLES);

    for (const style of POLL_VOTING_STYLES) {
      expect(votingStyleLabel(style)).toBe(VOTING_STYLE_METADATA[style].label);
      expect(votingStyleVoterDescription(style)).toBe(VOTING_STYLE_METADATA[style].voterDescription);
      expect(VOTING_STYLE_METADATA[style].icon).toBeTruthy();
    }
  });

  it('exposes labels, descriptions, and linked-event requirements for every eligibility source', () => {
    expect(voterEligibilityOptions.map((option) => option.source)).toEqual(POLL_VOTER_ELIGIBILITY_SOURCES);

    for (const source of POLL_VOTER_ELIGIBILITY_SOURCES) {
      expect(voterEligibilityLabel(source)).toBe(VOTER_ELIGIBILITY_METADATA[source].label);
      expect(voterEligibilityDescription(source)).toBe(VOTER_ELIGIBILITY_METADATA[source].description);
      expect(requiresLinkedEventEligibilitySource(source)).toBe(
        VOTER_ELIGIBILITY_METADATA[source].requiresLinkedEvent,
      );
    }
  });

  it.each([
    ['computerScienceStudents', true],
    ['eventAttendanceComputerScienceStudents', true],
    ['authenticatedUsers', false],
    ['eventAttendance', false],
  ] satisfies [PollVoterEligibilitySource, boolean][])(
    'detects whether %s supports verified Unesp roles',
    (source, expected) => {
      expect(supportsVerifiedUnespRoleRequirement(source)).toBe(expected);
    },
  );
});
