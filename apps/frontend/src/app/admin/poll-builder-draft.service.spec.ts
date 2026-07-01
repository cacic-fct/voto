import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { PollBuilderDraftService } from './poll-builder-draft.service';

describe('PollBuilderDraftService', () => {
  let service: PollBuilderDraftService;

  function textEvent(value: string, tag: 'input' | 'textarea' = 'input'): Event {
    const element = tag === 'input' ? document.createElement('input') : document.createElement('textarea');
    element.value = value;
    return { target: element } as unknown as Event;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PollBuilderDraftService],
    });

    service = TestBed.inject(PollBuilderDraftService);
  });

  it('should create a blank draft', () => {
    expect(service.draft().title).toBe('');
    expect(service.draft().status).toBe('draft');
    expect(service.draft().mode).toBe('regular');
    expect(service.draft().cacicElectionPhase).toBeUndefined();
    expect(service.draft().resultsPublic).toBe(false);
    expect(service.draft().resultsLive).toBe(false);
    expect(service.draft().allowResponseEditing).toBe(false);
    expect(service.draft().allowMultipleResponses).toBe(false);
    expect(service.draft().visibleFrom).toBeUndefined();
    expect(service.draft().votingStartsAt).toBeUndefined();
    expect(service.draft().votingEndsAt).toBeUndefined();
    expect(service.canSave()).toBe(false);
  });

  it('should add choice elements with default options', () => {
    service.addElement('selectionDropdown');

    const [element] = service.draft().elements;
    expect(element.type).toBe('selectionDropdown');
    expect(element.required).toBe(true);
    expect(element.options).toHaveLength(2);
  });

  it('should add grid elements with row and column settings', () => {
    service.addElement('singleSelectionGrid');

    const [element] = service.draft().elements;
    expect(element.type).toBe('singleSelectionGrid');
    expect(element.required).toBe(true);
    expect(element.options).toEqual([]);
    expect(element.settings?.grid?.rows).toHaveLength(2);
    expect(element.settings?.grid?.columns).toHaveLength(2);
  });

  it('should add scale and rating elements with default settings', () => {
    service.addElement('linearScale');
    service.addElement('starRating');

    const [scale, rating] = service.draft().elements;
    expect(scale.settings?.linearScale).toMatchObject({ min: 1, max: 5 });
    expect(rating.settings?.starRating).toMatchObject({ max: 5 });
  });

  it('should add scheduling elements with host availability settings', () => {
    service.addElement('scheduling');

    const [element] = service.draft().elements;
    expect(element.type).toBe('scheduling');
    expect(element.required).toBe(true);
    expect(element.options).toEqual([]);
    expect(element.settings?.scheduling).toMatchObject({
      timezone: 'America/Sao_Paulo',
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      inviteeMode: 'optional',
      maxInvitees: 3,
    });
    expect(element.settings?.scheduling?.availability).toHaveLength(2);
  });

  it('should expose America Sao Paulo as the first scheduling timezone option', () => {
    expect(service.schedulingTimezoneOptions[0]).toBe('America/Sao_Paulo');
    expect(service.schedulingTimezoneOptions).toContain('America/Sao_Paulo');
  });

  it('should copy the last scheduling availability date when adding another window', () => {
    service.addElement('scheduling');
    const [element] = service.draft().elements;
    const lastDate = element.settings?.scheduling?.availability.at(-1)?.date;

    service.addSchedulingAvailability(element.id);

    const [updatedElement] = service.draft().elements;
    expect(updatedElement.settings?.scheduling?.availability).toHaveLength(3);
    expect(updatedElement.settings?.scheduling?.availability.at(-1)?.date).toBe(lastDate);
  });

  it('should clear options when a choice element becomes informational', () => {
    service.addElement('multipleChoice');
    const [element] = service.draft().elements;

    service.updateElementType(element.id, { value: 'statement' } as never);

    const [updatedElement] = service.draft().elements;
    expect(updatedElement.type).toBe('statement');
    expect(updatedElement.required).toBe(false);
    expect(updatedElement.options).toEqual([]);
  });

  it('should link an event and clear event attendance eligibility when the event is removed', () => {
    const event = {
      id: 'event-1',
      name: 'Assembleia Geral',
      startDate: '2026-06-16T19:00:00.000Z',
      endDate: '2026-06-16T22:00:00.000Z',
      shouldCollectAttendance: true,
    };

    service.updateLinkedEvent({ value: 'event-1' } as never, [event]);
    service.updateVoterEligibilitySource({ value: 'eventAttendance' } as never);

    expect(service.draft().linkedEvent?.id).toBe('event-1');
    expect(service.draft().voterEligibilitySource).toBe('eventAttendance');

    service.updateLinkedEvent({ value: '' } as never, [event]);

    expect(service.draft().linkedEvent).toBeUndefined();
    expect(service.draft().voterEligibilitySource).toBe('authenticatedUsers');
  });

  it('should only keep verified role requirement for computer science eligibility', () => {
    service.updateVoterEligibilitySource({ value: 'computerScienceStudents' } as never);
    service.updateRequireVerifiedUnespRole({ checked: true } as never);

    expect(service.draft().requireVerifiedUnespRole).toBe(true);

    service.updateVoterEligibilitySource({ value: 'unespUsers' } as never);

    expect(service.draft().voterEligibilitySource).toBe('unespUsers');
    expect(service.draft().requireVerifiedUnespRole).toBe(false);
  });

  it('should only keep live results when public results are enabled', () => {
    service.updateResultsLive({ checked: true } as never);

    expect(service.draft().resultsLive).toBe(false);

    service.updateResultsPublic({ checked: true } as never);
    service.updateResultsLive({ checked: true } as never);

    expect(service.draft().resultsPublic).toBe(true);
    expect(service.draft().resultsLive).toBe(true);

    service.updateResultsPublic({ checked: false } as never);

    expect(service.draft().resultsPublic).toBe(false);
    expect(service.draft().resultsLive).toBe(false);
  });

  it('should disable response editing for anonymous and multiple response polls', () => {
    service.updateAllowResponseEditing({ checked: true } as never);

    expect(service.draft().allowResponseEditing).toBe(true);

    service.updateVotingStyle({ value: 'anonymous' } as never);

    expect(service.draft().allowResponseEditing).toBe(false);

    service.updateVotingStyle({ value: 'secret' } as never);
    service.updateAllowMultipleResponses({ checked: true } as never);
    service.updateAllowResponseEditing({ checked: true } as never);

    expect(service.draft().allowMultipleResponses).toBe(true);
    expect(service.draft().allowResponseEditing).toBe(false);
  });

  it('should apply CACiC slate-submission rules without changing regular poll controls', () => {
    service.updatePollMode({ value: 'cacicElection' } as never);
    service.updateDirectLinkEnabled({ checked: true } as never);
    service.updateResultsPublic({ checked: true } as never);
    service.updateResultsLive({ checked: true } as never);

    expect(service.draft()).toMatchObject({
      mode: 'cacicElection',
      cacicElectionPhase: 'slateSubmission',
      directLinkEnabled: false,
      resultsPublic: false,
      resultsLive: false,
    });
    expect(service.isCacicElection()).toBe(true);
    expect(service.isCacicElectionSlateSubmission()).toBe(true);
    expect(service.toSaveRequest()).toMatchObject({
      mode: 'cacicElection',
      cacicElectionPhase: 'slateSubmission',
      directLinkEnabled: false,
      resultsPublic: false,
      resultsLive: false,
    });
  });

  it('should force CACiC election voting privacy, eligibility, and submission rules', () => {
    service.updatePollMode({ value: 'cacicElection' } as never);
    service.updateVotingStyle({ value: 'public' } as never);
    service.updateVoterEligibilitySource({ value: 'eventAttendance' } as never);
    service.updateRequireVerifiedUnespRole({ checked: true } as never);
    service.updateAllowMultipleResponses({ checked: true } as never);
    service.updateAllowResponseEditing({ checked: true } as never);
    service.updateCacicElectionPhase({ value: 'election' } as never);

    expect(service.draft()).toMatchObject({
      mode: 'cacicElection',
      cacicElectionPhase: 'election',
      votingStyle: 'anonymous',
      voterEligibilitySource: 'enrollmentList',
      requireVerifiedUnespRole: false,
      directLinkEnabled: false,
      resultsPublic: true,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      linkedEvent: undefined,
    });
    expect(service.isCacicElectionVoting()).toBe(true);
    expect(service.toSaveRequest()).toMatchObject({
      mode: 'cacicElection',
      cacicElectionPhase: 'election',
      votingStyle: 'anonymous',
      voterEligibilitySource: 'enrollmentList',
      requireVerifiedUnespRole: false,
      resultsPublic: true,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      linkedEventId: undefined,
    });
  });

  it('should update poll text fields and reset to a new poll', () => {
    service.updatePollTitle(textEvent(' Assembleia '));
    service.updatePollDescription(textEvent('Descrição da votação', 'textarea'));

    expect(service.draft().title).toBe(' Assembleia ');
    expect(service.draft().description).toBe('Descrição da votação');
    expect(service.canSave()).toBe(true);

    service.newPoll();

    expect(service.draft().title).toBe('');
    expect(service.draft().description).toBe('');
    expect(service.canSave()).toBe(false);
  });

  it('should store publication schedule values at minute precision', () => {
    service.updateVisibleFrom(textEvent('2026-06-27T09:10:45'));
    service.updateVotingStartsAt(textEvent('2026-06-27T10:11:32'));
    service.updateVotingEndsAt(textEvent('2026-06-27T18:12:59'));

    expect(service.draft().visibleFrom).toBe(new Date('2026-06-27T09:10:00').toISOString());
    expect(service.draft().votingStartsAt).toBe(new Date('2026-06-27T10:11:00').toISOString());
    expect(service.draft().votingEndsAt).toBe(new Date('2026-06-27T18:12:00').toISOString());
    expect(service.dateTimeInputValue(service.draft().votingStartsAt)).toBe('2026-06-27T10:11');
    expect(service.toSaveRequest()).toMatchObject({
      visibleFrom: new Date('2026-06-27T09:10:00').toISOString(),
      votingStartsAt: new Date('2026-06-27T10:11:00').toISOString(),
      votingEndsAt: new Date('2026-06-27T18:12:00').toISOString(),
    });

    service.updateVotingEndsAt(textEvent(''));

    expect(service.draft().votingEndsAt).toBeNull();
    expect(service.toSaveRequest()).toMatchObject({
      votingEndsAt: null,
    });
  });

  it('should reorder and remove elements', () => {
    service.addElement('shortText');
    service.addElement('longText');
    const [first, second] = service.draft().elements;

    service.dropElement({ previousIndex: 0, currentIndex: 1 } as never);

    expect(service.draft().elements.map((element) => element.id)).toEqual([second.id, first.id]);

    service.removeElement(second.id);

    expect(service.draft().elements.map((element) => element.id)).toEqual([first.id]);
  });

  it('should add, edit, and remove choice options', () => {
    service.addElement('singleChoice');
    const element = service.draft().elements[0];
    const firstOption = element.options[0];

    service.addOption(element.id);
    service.updateOptionLabel(element.id, firstOption.id, textEvent('Sim'));
    service.updateOptionDescription(element.id, firstOption.id, textEvent('Voto favorável', 'textarea'));
    service.removeOption(element.id, element.options[1].id);

    const updatedElement = service.draft().elements[0];
    expect(updatedElement.options).toHaveLength(2);
    expect(updatedElement.options[0]).toMatchObject({ label: 'Sim', description: 'Voto favorável' });
  });

  it('should update element text, required state, and create missing choice options when needed', () => {
    service.addElement('statement');
    const element = service.draft().elements[0];

    service.updateElementTitle(element.id, textEvent('Título atualizado'));
    service.updateElementDescription(element.id, textEvent('Descrição atualizada', 'textarea'));
    service.updateElementRequired(element.id, { checked: true } as never);
    service.updateElementType(element.id, { value: 'singleChoice' } as never);

    const updatedElement = service.draft().elements[0];
    expect(updatedElement).toMatchObject({
      title: 'Título atualizado',
      description: 'Descrição atualizada',
      required: true,
      type: 'singleChoice',
    });
    expect(updatedElement.options).toHaveLength(2);
  });

  it('should add, edit, and remove grid rows and columns', () => {
    service.addElement('multipleSelectionGrid');
    const element = service.draft().elements[0];
    const firstRow = element.settings?.grid?.rows[0];
    const firstColumn = element.settings?.grid?.columns[0];

    service.addGridOption(element.id, 'rows');
    service.addGridOption(element.id, 'columns');
    service.updateGridOptionLabel(element.id, 'rows', firstRow?.id ?? '', textEvent('Atividade'));
    service.updateGridOptionDescription(element.id, 'columns', firstColumn?.id ?? '', textEvent('Período matutino'));
    service.removeGridOption(element.id, 'rows', element.settings?.grid?.rows[1].id ?? '');
    service.removeGridOption(element.id, 'columns', element.settings?.grid?.columns[1].id ?? '');

    const grid = service.draft().elements[0].settings?.grid;
    expect(grid?.rows).toHaveLength(2);
    expect(grid?.columns).toHaveLength(2);
    expect(grid?.rows[0].label).toBe('Atividade');
    expect(grid?.columns[0].description).toBe('Período matutino');
  });

  it('should ignore invalid select values when updating enums', () => {
    service.addElement('shortText');
    const original = service.draft();

    service.updateVotingStyle({ value: 'invalid' } as never);
    service.updateVoterEligibilitySource({ value: 'invalid' } as never);
    service.updateElementType(original.elements[0].id, { value: 'invalid' } as never);

    expect(service.draft()).toEqual(original);
  });

  it('should update linear scale bounds and labels with validation', () => {
    service.addElement('linearScale');
    const elementId = service.draft().elements[0].id;

    service.updateLinearScaleMin(elementId, { value: 7 } as never);
    service.updateLinearScaleMax(elementId, { value: 1 } as never);
    expect(service.draft().elements[0].settings?.linearScale).toMatchObject({ min: 1, max: 5 });

    service.updateLinearScaleMin(elementId, { value: 0 } as never);
    service.updateLinearScaleMax(elementId, { value: 10 } as never);
    service.updateLinearScaleLabel(elementId, 'minLabel', textEvent('Discordo'));
    service.updateLinearScaleLabel(elementId, 'maxLabel', textEvent('Concordo'));

    expect(service.draft().elements[0].settings?.linearScale).toEqual({
      min: 0,
      max: 10,
      minLabel: 'Discordo',
      maxLabel: 'Concordo',
    });
  });

  it('should update star rating bounds with validation', () => {
    service.addElement('starRating');
    const elementId = service.draft().elements[0].id;

    service.updateStarRatingMax(elementId, { value: 2 } as never);
    expect(service.draft().elements[0].settings?.starRating).toEqual({ max: 5 });

    service.updateStarRatingMax(elementId, { value: 10 } as never);
    expect(service.draft().elements[0].settings?.starRating).toEqual({ max: 10 });
  });

  it('should update scheduling settings and availability windows', () => {
    service.addElement('scheduling');
    const elementId = service.draft().elements[0].id;
    const firstAvailability = service.draft().elements[0].settings?.scheduling?.availability[0];

    service.updateSchedulingText(elementId, 'hostName', textEvent('Comissão'));
    service.updateSchedulingText(elementId, 'location', textEvent('Sala 1'));
    service.updateSchedulingTimezone(elementId, { value: 'America/Sao_Paulo' } as never);
    service.updateSchedulingNumber(elementId, 'durationMinutes', { value: 60 } as never);
    service.updateSchedulingNumber(elementId, 'slotIntervalMinutes', { value: 15 } as never);
    service.updateSchedulingNumber(elementId, 'bufferBeforeMinutes', { value: 5 } as never);
    service.updateSchedulingNumber(elementId, 'bufferAfterMinutes', { value: 10 } as never);
    service.updateSchedulingNumber(elementId, 'maxInvitees', { value: 4 } as never);
    service.updateSchedulingInviteeMode(elementId, { value: 'required' } as never);
    service.addSchedulingAvailability(elementId);
    service.updateSchedulingAvailability(elementId, firstAvailability?.id ?? '', 'date', textEvent('2026-06-24'));
    service.updateSchedulingAvailability(elementId, firstAvailability?.id ?? '', 'startTime', textEvent('08:30'));
    service.updateSchedulingAvailability(elementId, firstAvailability?.id ?? '', 'endTime', textEvent('11:30'));
    service.removeSchedulingAvailability(elementId, service.draft().elements[0].settings?.scheduling?.availability[1].id ?? '');

    const scheduling = service.draft().elements[0].settings?.scheduling;
    expect(scheduling).toMatchObject({
      hostName: 'Comissão',
      location: 'Sala 1',
      timezone: 'America/Sao_Paulo',
      durationMinutes: 60,
      slotIntervalMinutes: 15,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 10,
      inviteeMode: 'required',
      maxInvitees: 4,
    });
    expect(scheduling?.availability).toHaveLength(2);
    expect(scheduling?.availability[0]).toMatchObject({
      date: '2026-06-24',
      startTime: '08:30',
      endTime: '11:30',
    });
  });

  it('should ignore invalid scheduling numbers and clear invitees when disabled', () => {
    service.addElement('scheduling');
    const elementId = service.draft().elements[0].id;

    service.updateSchedulingNumber(elementId, 'durationMinutes', { value: '60' } as never);
    service.updateSchedulingTimezone(elementId, { value: '' } as never);
    service.updateSchedulingInviteeMode(elementId, { value: 'invalid' } as never);
    expect(service.draft().elements[0].settings?.scheduling).toMatchObject({
      durationMinutes: 30,
      inviteeMode: 'optional',
      maxInvitees: 3,
    });

    service.updateSchedulingInviteeMode(elementId, { value: 'none' } as never);
    expect(service.draft().elements[0].settings?.scheduling).toMatchObject({
      inviteeMode: 'none',
      maxInvitees: 0,
    });
  });

  it('should expose element predicates, labels, and status labels', () => {
    expect(service.isOptionChoiceElement('singleChoice')).toBe(true);
    expect(service.isOptionChoiceElement('date')).toBe(false);
    expect(service.isGridElement('singleSelectionGrid')).toBe(true);
    expect(service.isGridElement('shortText')).toBe(false);
    expect(service.isAnswerElement('statement')).toBe(false);
    expect(service.isAnswerElement('time')).toBe(true);
    expect(service.elementTypeLabel('shortText')).toBe('Resposta curta');
    expect(service.elementTypeOption('unknown' as never)).toEqual({ type: 'unknown', label: 'unknown', icon: 'help' });
    expect(service.statusLabel('draft')).toBe('Rascunho');
    expect(service.statusLabel('published')).toBe('Publicada');
    expect(service.statusLabel('closed')).toBe('Encerrada');
  });

  it('should normalize save requests for anonymous and multiple-response polls', () => {
    service.setDraft({
      ...service.draft(),
      id: 'poll-1',
      title: 'Votação',
      votingStyle: 'anonymous',
      resultsPublic: false,
      resultsLive: true,
      allowResponseEditing: true,
      allowMultipleResponses: true,
      linkedEvent: {
        id: 'event-1',
        name: 'Evento',
        startDate: '2026-06-16T10:00:00.000Z',
        endDate: '2026-06-16T12:00:00.000Z',
      },
    });

    expect(service.toSaveRequest()).toMatchObject({
      title: 'Votação',
      resultsPublic: false,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: true,
      linkedEventId: 'event-1',
    });
  });
});
