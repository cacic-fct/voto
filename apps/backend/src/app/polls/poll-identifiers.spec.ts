import { BadRequestException } from '@nestjs/common';
import {
  externalPollElementId,
  externalPollOptionId,
  namespacedPollElementId,
  namespacedPollOptionId,
  normalizePollIdentifier,
} from './poll-identifiers';

describe('poll identifier boundaries', () => {
  it('round-trips namespaced IDs even when base64url contains underscore characters', () => {
    const pollId = 'poll_/with?unicode-ção';
    const elementId = 'question:with.dot';
    const storedElementId = namespacedPollElementId(pollId, elementId);
    const storedOptionId = namespacedPollOptionId(storedElementId, 'option_/1');

    expect(externalPollElementId(pollId, storedElementId)).toBe(elementId);
    expect(externalPollOptionId(storedElementId, storedOptionId)).toBe('option_/1');
    expect(storedElementId).toMatch(/^_cacic_element_/);
    expect(storedOptionId).toMatch(/^_cacic_option_/);
  });

  it('does not accept internal IDs or blank/noncanonical client identifiers', () => {
    expect(() => normalizePollIdentifier('   ', 'Element id')).toThrow(BadRequestException);
    expect(() => normalizePollIdentifier('_cacic_element_internal', 'Element id')).toThrow(BadRequestException);
    expect(normalizePollIdentifier(' question-1 ', 'Element id')).toBe('question-1');
  });
});
