import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  AddPollEligibilityEnrollmentsRequest,
  ImportPollEligibilityEnrollmentsRequest,
  Poll,
  PollResultsDelta,
  SavePollRequest,
  SubmitPollResponseRequest,
  UpdateCacicElectionSlateRequest,
} from '@org/voting-contracts';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollApiService } from './poll-api.service';

describe('PollApiService', () => {
  let service: PollApiService;
  let http: HttpTestingController;
  const originalEventSource = globalThis.EventSource;

  const poll = {
    id: 'poll-1',
    title: 'Votação',
    description: '',
    status: 'draft',
    mode: 'regular',
    votingStyle: 'secret',
    voterEligibilitySource: 'authenticatedUsers',
    requireVerifiedUnespRole: false,
    directLinkEnabled: false,
    resultsPublic: false,
    resultsLive: false,
    allowResponseEditing: false,
    allowMultipleResponses: false,
    elements: [],
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  } satisfies Poll;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(PollApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    if (originalEventSource) {
      vi.stubGlobal('EventSource', originalEventSource);
    }
  });

  it('loads public poll data and responses through the public API', async () => {
    const summaryResponse = firstValueFrom(service.listPublicPolls());
    http.expectOne('/api/polls').flush([{ id: 'poll-1' }]);
    await expect(summaryResponse).resolves.toEqual([{ id: 'poll-1' }]);

    const detailResponse = firstValueFrom(service.getPublicPoll('poll-1'));
    http.expectOne('/api/polls/poll-1').flush(poll);
    await expect(detailResponse).resolves.toEqual(poll);

    const submitRequest: SubmitPollResponseRequest = {
      answers: [{ elementId: 'element-1', value: 'Sim' }],
    };
    const submitResponse = firstValueFrom(service.submitResponse('poll-1', submitRequest));
    const submit = http.expectOne('/api/polls/poll-1/responses');
    expect(submit.request.method).toBe('POST');
    expect(submit.request.body).toEqual(submitRequest);
    submit.flush({ id: 'response-1' });
    await expect(submitResponse).resolves.toEqual({ id: 'response-1' });

    const stateResponse = firstValueFrom(service.getMyPollResponse('poll-1'));
    http.expectOne('/api/polls/poll-1/responses/me').flush({ hasSubmitted: false });
    await expect(stateResponse).resolves.toEqual({ hasSubmitted: false });
  });

  it('loads direct-link poll data and responses through token endpoints', async () => {
    const token = '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad';

    const detailResponse = firstValueFrom(service.getDirectLinkPoll(token));
    http.expectOne(`/api/polls/direct/${token}`).flush(poll);
    await expect(detailResponse).resolves.toEqual(poll);

    const submitRequest: SubmitPollResponseRequest = {
      answers: [{ elementId: 'element-1', value: 'Sim' }],
    };
    const submitResponse = firstValueFrom(service.submitDirectLinkResponse(token, submitRequest));
    const submit = http.expectOne(`/api/polls/direct/${token}/responses`);
    expect(submit.request.method).toBe('POST');
    expect(submit.request.body).toEqual(submitRequest);
    submit.flush({ id: 'response-1' });
    await expect(submitResponse).resolves.toEqual({ id: 'response-1' });

    const stateResponse = firstValueFrom(service.getMyDirectLinkPollResponse(token));
    http.expectOne(`/api/polls/direct/${token}/responses/me`).flush({ hasSubmitted: false });
    await expect(stateResponse).resolves.toEqual({ hasSubmitted: false });

    const resultsResponse = firstValueFrom(service.getDirectLinkPollResults(token));
    http.expectOne(`/api/polls/direct/${token}/results`).flush({
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 0,
      responses: [],
    });
    await expect(resultsResponse).resolves.toEqual({
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 0,
      responses: [],
    });
  });

  it('loads and mutates admin poll data through the admin API', async () => {
    const saveRequest: SavePollRequest = {
      title: 'Votação',
      description: '',
      status: 'draft',
      votingStyle: 'secret',
      voterEligibilitySource: 'authenticatedUsers',
      requireVerifiedUnespRole: false,
      directLinkEnabled: false,
      resultsPublic: false,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      linkedEventId: undefined,
      elements: [],
    };

    const listResponse = firstValueFrom(service.listAdminPolls());
    http.expectOne('/api/admin/polls').flush([{ id: 'poll-1' }]);
    await expect(listResponse).resolves.toEqual([{ id: 'poll-1' }]);

    const eventsResponse = firstValueFrom(service.listLinkableEvents());
    http.expectOne('/api/admin/polls/linkable-events').flush([{ id: 'event-1' }]);
    await expect(eventsResponse).resolves.toEqual([{ id: 'event-1' }]);

    const adminPoll = firstValueFrom(service.getAdminPoll('poll-1'));
    http.expectOne('/api/admin/polls/poll-1').flush(poll);
    await expect(adminPoll).resolves.toEqual(poll);

    const create = firstValueFrom(service.createPoll(saveRequest));
    const createRequest = http.expectOne('/api/admin/polls');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(saveRequest);
    createRequest.flush(poll);
    await expect(create).resolves.toEqual(poll);

    const update = firstValueFrom(service.updatePoll('poll-1', saveRequest));
    const updateRequest = http.expectOne('/api/admin/polls/poll-1');
    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).toEqual(saveRequest);
    updateRequest.flush(poll);
    await expect(update).resolves.toEqual(poll);

    const imageFile = new File(['image'], 'chapa.png', { type: 'image/png' });
    const uploadImage = firstValueFrom(service.uploadPollImage('poll-1', imageFile));
    const uploadImageRequest = http.expectOne('/api/admin/polls/poll-1/images');
    expect(uploadImageRequest.request.method).toBe('POST');
    expect(uploadImageRequest.request.body).toBeInstanceOf(FormData);
    uploadImageRequest.flush({ id: 'image-1', url: '/api/polls/poll-1/images/image-1', width: 800, height: 450 });
    await expect(uploadImage).resolves.toEqual({
      id: 'image-1',
      url: '/api/polls/poll-1/images/image-1',
      width: 800,
      height: 450,
    });

    const deleteImage = firstValueFrom(service.deletePollImage('poll-1', 'image-1'));
    const deleteImageRequest = http.expectOne('/api/admin/polls/poll-1/images/image-1');
    expect(deleteImageRequest.request.method).toBe('DELETE');
    deleteImageRequest.flush(null);
    await expect(deleteImage).resolves.toBeNull();

    const status = firstValueFrom(service.updatePollStatus('poll-1', 'published'));
    const statusRequest = http.expectOne('/api/admin/polls/poll-1/status');
    expect(statusRequest.request.method).toBe('PATCH');
    expect(statusRequest.request.body).toEqual({ status: 'published' });
    statusRequest.flush({ ...poll, status: 'published' });
    await expect(status).resolves.toEqual({ ...poll, status: 'published' });

    const deletePoll = firstValueFrom(service.deletePoll('poll-1'));
    const deleteRequest = http.expectOne('/api/admin/polls/poll-1');
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush(null);
    await expect(deletePoll).resolves.toBeNull();
  });

  it('manages eligibility enrollments through encoded admin endpoints', async () => {
    const addRequest: AddPollEligibilityEnrollmentsRequest = { enrollmentNumbers: ['123', '456'] };
    const importRequest: ImportPollEligibilityEnrollmentsRequest = {
      content: 'matricula\n123',
      fileName: 'matriculas.csv',
      format: 'csv',
      mode: 'append',
      selectedHeader: 'matricula',
    };

    const list = firstValueFrom(service.listPollEligibilityEnrollments('poll-1'));
    http.expectOne('/api/admin/polls/poll-1/eligibility-enrollments').flush({ entries: [], totalCount: 0 });
    await expect(list).resolves.toEqual({ entries: [], totalCount: 0 });

    const add = firstValueFrom(service.addPollEligibilityEnrollments('poll-1', addRequest));
    const addHttp = http.expectOne('/api/admin/polls/poll-1/eligibility-enrollments');
    expect(addHttp.request.method).toBe('POST');
    expect(addHttp.request.body).toEqual(addRequest);
    addHttp.flush({ entries: [], totalCount: 0, createdCount: 2 });
    await expect(add).resolves.toEqual({ entries: [], totalCount: 0, createdCount: 2 });

    const importResult = firstValueFrom(service.importPollEligibilityEnrollments('poll-1', importRequest));
    const importHttp = http.expectOne('/api/admin/polls/poll-1/eligibility-enrollments/import');
    expect(importHttp.request.method).toBe('PUT');
    expect(importHttp.request.body).toEqual(importRequest);
    importHttp.flush({ entries: [], totalCount: 0, createdCount: 1 });
    await expect(importResult).resolves.toEqual({ entries: [], totalCount: 0, createdCount: 1 });

    const remove = firstValueFrom(service.deletePollEligibilityEnrollment('poll-1', '12/34 56'));
    const removeRequest = http.expectOne('/api/admin/polls/poll-1/eligibility-enrollments/12%2F34%2056');
    expect(removeRequest.request.method).toBe('DELETE');
    removeRequest.flush(null);
    await expect(remove).resolves.toBeNull();

    const clear = firstValueFrom(service.clearPollEligibilityEnrollments('poll-1'));
    const clearRequest = http.expectOne('/api/admin/polls/poll-1/eligibility-enrollments');
    expect(clearRequest.request.method).toBe('DELETE');
    clearRequest.flush({ entries: [], totalCount: 0 });
    await expect(clear).resolves.toEqual({ entries: [], totalCount: 0 });
  });

  it('loads results and parses live result deltas', async () => {
    const adminResults = firstValueFrom(service.getAdminPollResults('poll-1'));
    http.expectOne('/api/admin/polls/poll-1/results').flush({
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 0,
      responses: [],
    });
    await expect(adminResults).resolves.toEqual({
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 0,
      responses: [],
    });

    const exportResult = firstValueFrom(service.exportCacicElectionVoterEnrollments('poll-1'));
    const exportRequest = http.expectOne('/api/admin/polls/poll-1/cacic-election/voter-enrollments.txt');
    expect(exportRequest.request.method).toBe('GET');
    expect(exportRequest.request.responseType).toBe('blob');
    const exportBlob = new Blob(['24123456\n25123456'], { type: 'text/plain' });
    exportRequest.flush(exportBlob);
    await expect(exportResult).resolves.toBe(exportBlob);

    const publicResults = firstValueFrom(service.getPublicPollResults('poll-1'));
    http.expectOne('/api/polls/poll-1/results').flush({
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 0,
      responses: [],
    });
    await expect(publicResults).resolves.toEqual({
      pollId: 'poll-1',
      anonymous: false,
      answersReleased: true,
      responseCount: 0,
      responses: [],
    });

    const delta: PollResultsDelta = { pollId: 'poll-1', responseCount: 1, responses: [] };
    expect(service.parseResultsDelta({ data: JSON.stringify(delta) } as MessageEvent<string>)).toEqual(delta);
    expect(service.parseResultsDelta({ data: '{' } as MessageEvent<string>)).toBeNull();
  });

  it('manages CACiC election slate endpoints', async () => {
    const slateRequest: UpdateCacicElectionSlateRequest = {
      name: 'Chapa Aurora',
      members: [
        {
          fullName: 'Ada Lovelace',
          role: 'president',
          isRepresentative: true,
          identifierType: 'email',
          identifierValue: 'ada@example.com',
        },
      ],
    };
    const slateResponse = {
      id: 'slate-1',
      pollId: 'poll-1',
      name: 'Chapa Aurora',
      status: 'pending',
      enabled: true,
      submissionSource: 'public',
      submittedAt: '2026-06-16T10:00:00.000Z',
      members: [{ id: 'member-1', fullName: 'Ada Lovelace', role: 'president', isRepresentative: true }],
    };
    const adminSlateResponse = {
      ...slateResponse,
      members: [{ ...slateResponse.members[0], identifierType: 'email', identifierValue: 'ada@example.com' }],
    };

    const publicList = firstValueFrom(service.listPublicCacicElectionSlates('poll-1'));
    http.expectOne('/api/polls/poll-1/cacic-election/slates').flush([slateResponse]);
    await expect(publicList).resolves.toEqual([slateResponse]);

    const mySlate = firstValueFrom(service.getMyCacicElectionSlate('poll-1'));
    http.expectOne('/api/polls/poll-1/cacic-election/slates/me').flush(adminSlateResponse);
    await expect(mySlate).resolves.toEqual(adminSlateResponse);

    const submit = firstValueFrom(service.submitCacicElectionSlate('poll-1', slateRequest));
    const submitRequest = http.expectOne('/api/polls/poll-1/cacic-election/slates/me');
    expect(submitRequest.request.method).toBe('PUT');
    expect(submitRequest.request.body).toEqual(slateRequest);
    submitRequest.flush(slateResponse);
    await expect(submit).resolves.toEqual(slateResponse);

    const adminList = firstValueFrom(service.listAdminCacicElectionSlates('poll-1'));
    http.expectOne('/api/admin/polls/poll-1/cacic-election/slates').flush([adminSlateResponse]);
    await expect(adminList).resolves.toEqual([adminSlateResponse]);

    const createAdmin = firstValueFrom(service.createAdminCacicElectionSlate('poll-1', slateRequest));
    const createAdminRequest = http.expectOne('/api/admin/polls/poll-1/cacic-election/slates');
    expect(createAdminRequest.request.method).toBe('POST');
    expect(createAdminRequest.request.body).toEqual(slateRequest);
    createAdminRequest.flush(adminSlateResponse);
    await expect(createAdmin).resolves.toEqual(adminSlateResponse);

    const updateAdmin = firstValueFrom(service.updateAdminCacicElectionSlate('poll-1', 'slate/1', slateRequest));
    const updateAdminRequest = http.expectOne('/api/admin/polls/poll-1/cacic-election/slates/slate%2F1');
    expect(updateAdminRequest.request.method).toBe('PUT');
    expect(updateAdminRequest.request.body).toEqual(slateRequest);
    updateAdminRequest.flush(adminSlateResponse);
    await expect(updateAdmin).resolves.toEqual(adminSlateResponse);

    const reject = firstValueFrom(service.rejectCacicElectionSlate('poll-1', 'slate/1', { reason: 'Faltou cargo.' }));
    const rejectRequest = http.expectOne('/api/admin/polls/poll-1/cacic-election/slates/slate%2F1/rejection');
    expect(rejectRequest.request.method).toBe('PATCH');
    expect(rejectRequest.request.body).toEqual({ reason: 'Faltou cargo.' });
    rejectRequest.flush({ ...adminSlateResponse, status: 'rejected', rejectionReason: 'Faltou cargo.' });
    await expect(reject).resolves.toEqual({ ...adminSlateResponse, status: 'rejected', rejectionReason: 'Faltou cargo.' });

    const enabled = firstValueFrom(service.updateCacicElectionSlateEnabled('poll-1', 'slate/1', { enabled: false }));
    const enabledRequest = http.expectOne('/api/admin/polls/poll-1/cacic-election/slates/slate%2F1/enabled');
    expect(enabledRequest.request.method).toBe('PATCH');
    expect(enabledRequest.request.body).toEqual({ enabled: false });
    enabledRequest.flush({ ...adminSlateResponse, enabled: false });
    await expect(enabled).resolves.toEqual({ ...adminSlateResponse, enabled: false });

    const remove = firstValueFrom(service.deleteCacicElectionSlate('poll-1', 'slate/1'));
    const removeRequest = http.expectOne('/api/admin/polls/poll-1/cacic-election/slates/slate%2F1');
    expect(removeRequest.request.method).toBe('DELETE');
    removeRequest.flush(null);
    await expect(remove).resolves.toBeNull();
  });

  it('opens credentialed EventSource streams with encoded poll ids and non-negative cursors', () => {
    const eventSource = vi.fn(function EventSourceMock(this: EventSource, url: string, init?: EventSourceInit) {
      Object.assign(this, { url, init });
    });
    vi.stubGlobal('EventSource', eventSource);

    service.openAdminPollResultsEvents('poll/1', -2);
    service.openPublicPollResultsEvents('poll 2', 5);
    service.openDirectLinkPollResultsEvents('018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad', 3);

    expect(String(eventSource.mock.calls[0]?.[0])).toBe(
      `${window.location.origin}/api/admin/polls/poll%2F1/results/events?after=0`,
    );
    expect(eventSource.mock.calls[0]?.[1]).toEqual({ withCredentials: true });
    expect(String(eventSource.mock.calls[1]?.[0])).toBe(
      `${window.location.origin}/api/polls/poll%202/results/events?after=5`,
    );
    expect(eventSource.mock.calls[1]?.[1]).toEqual({ withCredentials: true });
    expect(String(eventSource.mock.calls[2]?.[0])).toBe(
      `${window.location.origin}/api/polls/direct/018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad/results/events?after=3`,
    );
    expect(eventSource.mock.calls[2]?.[1]).toEqual({ withCredentials: true });
  });
});
