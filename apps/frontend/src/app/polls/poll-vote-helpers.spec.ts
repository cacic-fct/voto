import { convertToParamMap } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  CACIC_ELECTION_VOTE_ELEMENT_ID,
  CacicElectionSlate,
  Poll,
  PollElement,
  PollResponse,
  PollResults,
} from '@org/voting-contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  gridTemplateColumns,
  isMultipleAnswerSelected,
  isMultipleGridColumnSelected,
  isNumberAnswerSelected,
  isRatingFilled,
  isRatingValueSelected,
  isRecord,
  isSingleAnswerSelected,
  isSingleGridColumnSelected,
  linearScaleValues,
  range,
  ratingOptionLabel,
  readMultipleGridAnswer,
  readSingleGridAnswer,
  responseAnswersToAnswerMap,
  setAnswerValue,
  setSchedulingInviteeAnswer,
  setSchedulingSlotAnswer,
  setSingleGridAnswerValue,
  singleAnswerValue,
  starRatingValues,
  textAnswerValue,
  toggleMultipleAnswerValue,
  toggleMultipleGridAnswerValue,
} from './poll-vote-answer-state';
import {
  canSubmitSlateInPoll,
  canVoteInPoll,
  emptyResponseState,
  isPollVotingOpen,
  readInstantTime,
  votingUnavailableTitle,
} from './poll-vote-availability';
import {
  cacicElectionBallotOptions,
  cacicElectionVoteElement,
  isCacicElectionPoll,
  isCacicElectionVotingPoll,
  isSlateSubmissionPoll,
  memberEnrollmentYearLabel,
  slateRoleLabel,
  slateStatusLabel,
  voteFormElements,
} from './poll-vote-cacic-election';
import {
  buildPollMetadataRuleItems,
  buildPollMetadataSummaryItems,
  voterEligibilityDeniedMessage,
} from './poll-vote-metadata';
import {
  buildPollResponseAnswers,
  submitErrorMessage,
  submittedResponseStateUpdate,
  submitSuccessMessage,
} from './poll-vote-response-state';
import { applyResultsDelta } from './poll-vote-results-state';
import {
  readSchedulingAnswer,
  schedulingInviteeIndexes,
  schedulingInviteeLabel,
  schedulingSlotGroups,
  schedulingSlots,
} from './poll-vote-scheduling';
import { pollResultsLink, resolvePollAccess } from './poll-vote-access';

const now = new Date('2026-06-21T12:00:00.000Z');

function createPoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: 'poll-1',
    title: 'Consulta',
    status: 'published',
    mode: 'regular',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: false,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    visibleFrom: '2026-06-21T11:00:00.000Z',
    votingStartsAt: '2026-06-21T11:00:00.000Z',
    votingEndsAt: '2026-06-21T13:00:00.000Z',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    elements: [],
    ...overrides,
  };
}

const choiceElement: PollElement = {
  id: 'choice',
  type: 'singleChoice',
  title: 'Escolha',
  required: true,
  options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
};

const schedulingElement: PollElement = {
  id: 'schedule',
  type: 'scheduling',
  title: 'Agenda',
  required: false,
  options: [],
  settings: {
    scheduling: {
      hostName: 'Comissão',
      location: 'Sala',
      timezone: 'America/Sao_Paulo',
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      inviteeMode: 'optional',
      maxInvitees: 2,
      availability: [{ id: 'window', date: '2026-06-24', startTime: '09:00', endTime: '10:30' }],
    },
  },
};

describe('poll vote access helpers', () => {
  it('resolves id and direct-link route access', () => {
    expect(resolvePollAccess(convertToParamMap({ directLinkToken: ' direct-token ', id: 'poll-1' }))).toEqual({
      kind: 'directLink',
      value: 'direct-token',
    });
    expect(resolvePollAccess(convertToParamMap({ id: ' poll-1 ' }))).toEqual({ kind: 'id', value: 'poll-1' });
    expect(resolvePollAccess(convertToParamMap({ id: ' ' }))).toBeNull();
    expect(pollResultsLink({ kind: 'directLink', value: 'direct-token' }, 'poll-1')).toEqual([
      '/polls/direct',
      'direct-token',
      'results',
    ]);
    expect(pollResultsLink({ kind: 'id', value: 'ignored' }, 'poll-1')).toEqual(['/polls', 'poll-1', 'results']);
  });
});

describe('poll vote answer-state helpers', () => {
  it('updates scalar, choice, grid, scheduling, and response answer maps', () => {
    let answers = setAnswerValue({}, 'text', 'Maria');
    answers = toggleMultipleAnswerValue(answers, 'multi', 'a', true);
    answers = toggleMultipleAnswerValue(answers, 'multi', 'b', true);
    answers = toggleMultipleAnswerValue(answers, 'multi', 'a', false);
    answers = setSingleGridAnswerValue(answers, 'single-grid', 'row-1', 'col-1');
    answers = toggleMultipleGridAnswerValue(answers, 'multi-grid', 'row-1', 'col-1', true);
    answers = toggleMultipleGridAnswerValue(answers, 'multi-grid', 'row-1', 'col-2', true);
    answers = toggleMultipleGridAnswerValue(answers, 'multi-grid', 'row-1', 'col-1', false);
    answers = setSchedulingSlotAnswer(answers, 'schedule', 'window:09:30');
    answers = setSchedulingInviteeAnswer(answers, 'schedule', 0, 'name', 'Ana');

    expect(answers).toMatchObject({
      text: 'Maria',
      multi: ['b'],
      'single-grid': { 'row-1': 'col-1' },
      'multi-grid': { 'row-1': ['col-2'] },
      schedule: { slotId: 'window:09:30', invitees: [{ name: 'Ana' }] },
    });
    expect(responseAnswersToAnswerMap([{ elementId: 'text', value: 'ok' }, { elementId: 'empty', value: null }])).toEqual({
      text: 'ok',
    });
  });

  it('reads answer values and selected states defensively', () => {
    const answers = {
      number: 4,
      text: 'Texto',
      single: 'a',
      multi: ['a'],
      rating: 3,
      singleGrid: { row: 'col' },
      multipleGrid: { row: ['col', 1] },
    };

    expect(range(2, 4)).toEqual([2, 3, 4]);
    expect(linearScaleValues({ ...choiceElement, settings: { linearScale: { min: 0, max: 2 } } })).toEqual([0, 1, 2]);
    expect(linearScaleValues(choiceElement)).toEqual([1, 2, 3, 4, 5]);
    expect(starRatingValues({ ...choiceElement, settings: { starRating: { max: 3 } } })).toEqual([1, 2, 3]);
    expect(starRatingValues(choiceElement)).toEqual([1, 2, 3, 4, 5]);
    expect(isNumberAnswerSelected(answers, 'number', 4)).toBe(true);
    expect(textAnswerValue(answers, 'number')).toBe('');
    expect(textAnswerValue(answers, 'text')).toBe('Texto');
    expect(singleAnswerValue(answers, 'single')).toBe('a');
    expect(isSingleAnswerSelected(answers, 'single', 'a')).toBe(true);
    expect(isMultipleAnswerSelected(answers, 'multi', 'a')).toBe(true);
    expect(isMultipleAnswerSelected(answers, 'single', 'a')).toBe(false);
    expect(isRatingFilled(answers, 'rating', 2)).toBe(true);
    expect(isRatingFilled(answers, 'text', 2)).toBe(false);
    expect(isRatingValueSelected(answers, 'rating', 3)).toBe(true);
    expect(ratingOptionLabel(answers, 'rating', 3)).toBe('3 estrelas selecionadas');
    expect(ratingOptionLabel(answers, 'rating', 4)).toBe('4 estrelas');
    expect(isSingleGridColumnSelected(answers, 'singleGrid', 'row', 'col')).toBe(true);
    expect(isMultipleGridColumnSelected(answers, 'multipleGrid', 'row', 'col')).toBe(true);
    expect(readSingleGridAnswer({ row: 1, other: 'col' })).toEqual({ other: 'col' });
    expect(readSingleGridAnswer(null)).toEqual({});
    expect(readMultipleGridAnswer({ row: ['col', 1], other: 'col' })).toEqual({ row: ['col'] });
    expect(readMultipleGridAnswer([])).toEqual({});
    expect(gridTemplateColumns({ ...choiceElement, settings: { grid: { rows: [], columns: [{ id: 'a', label: 'A' }] } } })).toBe(
      'minmax(10rem, 1.2fr) repeat(1, minmax(7rem, 1fr))',
    );
    expect(gridTemplateColumns(choiceElement)).toBe('minmax(10rem, 1.2fr) repeat(1, minmax(7rem, 1fr))');
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
  });
});

describe('poll vote availability helpers', () => {
  it('evaluates voting windows and response-state locks', () => {
    vi.useFakeTimers().setSystemTime(now);

    expect(readInstantTime(null, 10)).toBe(10);
    expect(readInstantTime('bad', 10)).toBe(10);
    expect(isPollVotingOpen(createPoll(), now)).toBe(true);
    expect(isPollVotingOpen(createPoll({ status: 'closed' }), now)).toBe(false);
    expect(isPollVotingOpen(createPoll({ visibleFrom: '2026-06-21T12:30:00.000Z' }), now)).toBe(false);
    expect(isPollVotingOpen(createPoll({ votingStartsAt: '2026-06-21T12:30:00.000Z' }), now)).toBe(false);
    expect(isPollVotingOpen(createPoll({ votingEndsAt: '2026-06-21T12:00:00.000Z' }), now)).toBe(false);
    expect(canVoteInPoll(null, emptyResponseState, false)).toBe(false);
    expect(canVoteInPoll(createPoll(), emptyResponseState, false)).toBe(true);
    expect(canVoteInPoll(createPoll(), { hasSubmitted: true, canEdit: false, canSubmitAnother: false }, false)).toBe(false);
    expect(canVoteInPoll(createPoll(), { hasSubmitted: true, canEdit: true, canSubmitAnother: false }, false)).toBe(true);
    expect(canVoteInPoll(createPoll(), emptyResponseState, true)).toBe(false);
    expect(canVoteInPoll(createPoll({ mode: 'cacicElection', cacicElectionPhase: 'slateSubmission' }), emptyResponseState, false)).toBe(
      false,
    );
    expect(canSubmitSlateInPoll(createPoll({ mode: 'cacicElection', cacicElectionPhase: 'slateSubmission' }))).toBe(true);
    expect(canSubmitSlateInPoll(createPoll())).toBe(false);
    expect(votingUnavailableTitle(null)).toBe('Votação encerrada');
    expect(votingUnavailableTitle(createPoll({ status: 'draft' }))).toBe('Votação encerrada');
    expect(votingUnavailableTitle(createPoll({ votingStartsAt: '2026-06-21T12:30:00.000Z' }))).toBe('Votação ainda não aberta');
    expect(votingUnavailableTitle(createPoll())).toBe('Votação encerrada');

    vi.useRealTimers();
  });
});

describe('poll vote CACiC election helpers', () => {
  it('derives CACiC election ballot data and labels', () => {
    const voteElement: PollElement = {
      ...choiceElement,
      id: CACIC_ELECTION_VOTE_ELEMENT_ID,
      options: [{ id: 'slate:slate-1', label: 'Chapa Aurora', description: 'Descrição' }, { id: 'blank', label: 'Branco' }],
    };
    const poll = createPoll({
      mode: 'cacicElection',
      cacicElectionPhase: 'election',
      elements: [choiceElement, voteElement],
    });
    const slate: CacicElectionSlate = {
      id: 'slate-1',
      pollId: poll.id,
      name: 'Chapa Aurora',
      status: 'approved',
      enabled: true,
      submissionSource: 'public',
      submittedAt: '2026-06-20T12:00:00.000Z',
      members: [],
    };

    expect(isSlateSubmissionPoll({ ...poll, cacicElectionPhase: 'slateSubmission' })).toBe(true);
    expect(isCacicElectionPoll(poll)).toBe(true);
    expect(isCacicElectionVotingPoll(poll)).toBe(true);
    expect(cacicElectionVoteElement(poll)).toBe(voteElement);
    expect(cacicElectionVoteElement(createPoll())).toBeNull();
    expect(voteFormElements(poll)).toEqual([choiceElement]);
    expect(cacicElectionBallotOptions(poll, [slate])).toEqual([
      { id: 'slate:slate-1', label: 'Chapa Aurora', description: 'Descrição', slate },
      { id: 'blank', label: 'Branco' },
    ]);
    expect(cacicElectionBallotOptions(createPoll(), [slate])).toEqual([]);
    expect(memberEnrollmentYearLabel({ id: 'm1', fullName: 'Ana', role: 'president', isRepresentative: true })).toBe(
      'Ano não informado',
    );
    expect(memberEnrollmentYearLabel({ id: 'm1', fullName: 'Ana', role: 'president', isRepresentative: true, enrollmentYear: '26' })).toBe(
      '2026',
    );
    expect(memberEnrollmentYearLabel({ id: 'm1', fullName: 'Ana', role: 'president', isRepresentative: true, enrollmentYear: '2024' })).toBe(
      '2024',
    );
    expect(['pending', 'approved', 'rejected'].map((status) => slateStatusLabel(status as CacicElectionSlate['status']))).toEqual([
      'Pendente',
      'Aprovada',
      'Rejeitada',
    ]);
    expect(slateRoleLabel('president')).toBe('Presidente');
    expect(slateRoleLabel('vicePresident')).toBe('Vice-Presidente');
    expect(slateRoleLabel('financialDirector')).toBe('Diretor Financeiro');
    expect(slateRoleLabel('communicationDirector')).toBe('Diretor de Comunicação');
    expect(slateRoleLabel('eventsDirector')).toBe('Diretor de Eventos');
    expect(slateRoleLabel('publicRelationsDirector')).toBe('Diretor de Relações Públicas');
    expect(slateRoleLabel('other')).toBe('Outro');
    expect(slateRoleLabel('other', 'Projetos')).toBe('Projetos');
  });
});

describe('poll vote metadata helpers', () => {
  it('builds summary, rule, and denied-message text', () => {
    const poll = createPoll({
      votingStyle: 'anonymous',
      voterEligibilitySource: 'eventAttendance',
      allowResponseEditing: true,
      allowMultipleResponses: true,
      linkedEvent: {
        id: 'event-1',
        name: 'SECOMP',
        startDate: '2026-06-20T10:00:00.000Z',
        endDate: '2026-06-20T12:00:00.000Z',
        shouldCollectAttendance: true,
      },
    });

    expect(buildPollMetadataSummaryItems(poll)).toEqual([
      { icon: 'visibility_off', label: 'Nível de sigilo', value: 'Anônimo' },
      { icon: 'how_to_reg', label: 'Habilitação', value: 'Presença no evento - todos' },
      { icon: 'event', label: 'Evento', value: 'SECOMP' },
    ]);
    expect(buildPollMetadataRuleItems(poll).map((item) => item.icon)).toEqual([
      'shield',
      'verified_user',
      'edit',
      'add_circle',
    ]);
    expect(
      buildPollMetadataRuleItems(createPoll({ mode: 'cacicElection', cacicElectionPhase: 'election' })).at(-1),
    ).toEqual({
      icon: 'bar_chart',
      text: 'Os resultados da eleição serão liberados somente após o encerramento.',
    });
    expect(voterEligibilityDeniedMessage('eventAttendance')).toContain('presença registrada');
    expect(voterEligibilityDeniedMessage('eventAttendanceUnespUsers')).toContain('unespianos com presença');
    expect(voterEligibilityDeniedMessage('eventAttendanceComputerScienceStudents')).toContain('alunos da computação');
    expect(voterEligibilityDeniedMessage('unespUsers')).toContain('unespianos');
    expect(voterEligibilityDeniedMessage('computerScienceStudents')).toContain('alunos da computação');
    expect(voterEligibilityDeniedMessage('enrollmentList')).toContain('matrículas cadastradas');
    expect(voterEligibilityDeniedMessage('authenticatedUsers')).toBe('Você não está habilitado a votar nesta votação.');
    expect(voterEligibilityDeniedMessage(undefined)).toBe('Você não está habilitado a votar nesta votação.');
  });
});

describe('poll vote response-state helpers', () => {
  it('builds response payloads, submit states, and localized messages', () => {
    const poll = createPoll({ elements: [choiceElement], allowMultipleResponses: true });
    const response: PollResponse = {
      id: 'response-1',
      pollId: poll.id,
      submittedAt: '2026-06-21T12:00:00.000Z',
      answers: [{ elementId: 'choice', value: 'a' }],
    };

    expect(buildPollResponseAnswers(poll, { choice: 'a' })).toEqual([{ elementId: 'choice', value: 'a' }]);
    expect(buildPollResponseAnswers(poll, {})).toEqual([{ elementId: 'choice', value: null }]);
    expect(submittedResponseStateUpdate(poll, response)).toEqual({
      responseState: { hasSubmitted: true, canEdit: false, canSubmitAnother: true },
      answers: {},
    });
    expect(submittedResponseStateUpdate(createPoll({ allowResponseEditing: true, votingStyle: 'secret' }), response)).toEqual({
      responseState: { hasSubmitted: true, canEdit: true, canSubmitAnother: false, response },
      answers: { choice: 'a' },
    });
    expect(submittedResponseStateUpdate(createPoll({ allowResponseEditing: true, votingStyle: 'anonymous' }), response)).toEqual({
      responseState: { hasSubmitted: true, canEdit: false, canSubmitAnother: false },
    });
    expect(submitSuccessMessage(poll, false)).toBe('Resposta registrada. Você pode enviar outra resposta.');
    expect(submitSuccessMessage(createPoll(), false)).toBe('Voto registrado.');
    expect(submitSuccessMessage(createPoll(), true)).toBe('Resposta atualizada.');
    expect(submitErrorMessage(new HttpErrorResponse({ status: 401 }), undefined)).toBe('Entre para votar nesta votação.');
    expect(submitErrorMessage(new HttpErrorResponse({ status: 403 }), 'unespUsers')).toBe(
      'Esta votação está disponível apenas para unespianos.',
    );
    expect(submitErrorMessage(new HttpErrorResponse({ status: 409 }), undefined)).toBe(
      'Sua resposta já foi registrada nesta votação.',
    );
    expect(submitErrorMessage(new Error('offline'), undefined)).toBe(
      'Não foi possível registrar sua resposta. Confira os campos obrigatórios.',
    );
  });
});

describe('poll vote results-state helpers', () => {
  it('merges matching deltas and ignores stale or missing snapshots', () => {
    const current: PollResults = {
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 1,
      responses: [{ id: 'response-1', answers: [{ elementId: 'choice', value: 'a' }] }],
    };

    expect(applyResultsDelta(null, { pollId: 'poll-1', responseCount: 2, responses: [] })).toBeNull();
    expect(applyResultsDelta(current, { pollId: 'other', responseCount: 2, responses: [] })).toBe(current);
    expect(
      applyResultsDelta(current, {
        pollId: 'poll-1',
        responseCount: 2,
        responses: [
          { id: 'response-1', answers: [{ elementId: 'choice', value: 'b' }] },
          { id: 'response-2', answers: [] },
        ],
      }),
    ).toMatchObject({
      responseCount: 2,
      responses: [
        { id: 'response-1', answers: [{ elementId: 'choice', value: 'b' }] },
        { id: 'response-2', answers: [] },
      ],
    });
  });
});

describe('poll vote scheduling helpers', () => {
  it('builds slot views and reads invitees defensively', () => {
    expect(schedulingSlots({ ...schedulingElement, settings: undefined })).toEqual([]);
    expect(schedulingSlots(schedulingElement)).toEqual([
      {
        id: 'window:09:15',
        date: '2026-06-24',
        startTime: '09:15',
        endTime: '09:45',
        windowId: 'window',
        label: '09:15 - 09:45',
        meta: '30 min',
      },
      {
        id: 'window:09:45',
        date: '2026-06-24',
        startTime: '09:45',
        endTime: '10:15',
        windowId: 'window',
        label: '09:45 - 10:15',
        meta: '30 min',
      },
    ]);
    expect(schedulingSlotGroups(schedulingElement)[0]).toMatchObject({
      date: '2026-06-24',
      label: expect.stringContaining('24/06/2026'),
    });
    expect(schedulingInviteeIndexes({ ...schedulingElement, settings: undefined })).toEqual([]);
    expect(
      schedulingInviteeIndexes({
        ...schedulingElement,
        settings: { scheduling: { ...schedulingElement.settings?.scheduling, inviteeMode: 'none' } },
      }),
    ).toEqual([]);
    expect(
      schedulingInviteeIndexes({
        ...schedulingElement,
        settings: { scheduling: { ...schedulingElement.settings?.scheduling, maxInvitees: -1 } },
      }),
    ).toEqual([]);
    expect(schedulingInviteeIndexes(schedulingElement)).toEqual([0, 1]);
    expect(schedulingInviteeLabel({ ...schedulingElement.settings?.scheduling, inviteeMode: 'required' })).toBe(
      'Convidados obrigatórios',
    );
    expect(schedulingInviteeLabel({ ...schedulingElement.settings?.scheduling, inviteeMode: 'optional' })).toBe(
      'Convidados opcionais',
    );
    expect(readSchedulingAnswer(null)).toEqual({ slotId: '', invitees: [] });
    expect(
      readSchedulingAnswer({
        slotId: 'window:09:15',
        invitees: [{ name: 'Ana', email: 'ana@example.com' }, null, { name: 1, email: 2 }],
      }),
    ).toEqual({
      slotId: 'window:09:15',
      invitees: [{ name: 'Ana', email: 'ana@example.com' }, { name: '', email: '' }],
    });
  });
});
