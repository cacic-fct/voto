import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AddPollEligibilityEnrollmentsRequest,
  AdminCacicElectionSlate,
  CacicElectionSlate,
  EventManagerEvent,
  ImportPollEligibilityEnrollmentsRequest,
  Poll,
  PollEligibilityEnrollmentImportResult,
  PollEligibilityEnrollmentList,
  PollImage,
  PollResponse,
  PollResults,
  PollResultsDelta,
  PollStatus,
  PollSummary,
  PollUserResponseState,
  RejectCacicElectionSlateRequest,
  SavePollRequest,
  SubmitCacicElectionSlateRequest,
  SubmitPollResponseRequest,
  UpdateCacicElectionSlateEnabledRequest,
  UpdateCacicElectionSlateRequest,
} from '@org/voting-contracts';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PollApiService {
  private readonly http = inject(HttpClient);

  listPublicPolls(): Observable<PollSummary[]> {
    return this.http.get<PollSummary[]>('/api/polls');
  }

  getPublicPoll(id: string): Observable<Poll> {
    return this.http.get<Poll>(`/api/polls/${id}`);
  }

  getDirectLinkPoll(directLinkToken: string): Observable<Poll> {
    return this.http.get<Poll>(`/api/polls/direct/${encodeURIComponent(directLinkToken)}`);
  }

  submitResponse(id: string, request: SubmitPollResponseRequest): Observable<PollResponse> {
    return this.http.post<PollResponse>(`/api/polls/${id}/responses`, request);
  }

  submitDirectLinkResponse(directLinkToken: string, request: SubmitPollResponseRequest): Observable<PollResponse> {
    return this.http.post<PollResponse>(
      `/api/polls/direct/${encodeURIComponent(directLinkToken)}/responses`,
      request,
    );
  }

  getMyPollResponse(id: string): Observable<PollUserResponseState> {
    return this.http.get<PollUserResponseState>(`/api/polls/${id}/responses/me`);
  }

  listPublicCacicElectionSlates(id: string): Observable<CacicElectionSlate[]> {
    return this.http.get<CacicElectionSlate[]>(`/api/polls/${id}/cacic-election/slates`);
  }

  getMyCacicElectionSlate(id: string): Observable<AdminCacicElectionSlate | null> {
    return this.http.get<AdminCacicElectionSlate | null>(`/api/polls/${id}/cacic-election/slates/me`);
  }

  submitCacicElectionSlate(
    id: string,
    request: SubmitCacicElectionSlateRequest,
  ): Observable<CacicElectionSlate> {
    return this.http.put<CacicElectionSlate>(`/api/polls/${id}/cacic-election/slates/me`, request);
  }

  getMyDirectLinkPollResponse(directLinkToken: string): Observable<PollUserResponseState> {
    return this.http.get<PollUserResponseState>(
      `/api/polls/direct/${encodeURIComponent(directLinkToken)}/responses/me`,
    );
  }

  listAdminPolls(): Observable<PollSummary[]> {
    return this.http.get<PollSummary[]>('/api/admin/polls');
  }

  listLinkableEvents(): Observable<EventManagerEvent[]> {
    return this.http.get<EventManagerEvent[]>('/api/admin/polls/linkable-events');
  }

  listPollEligibilityEnrollments(id: string): Observable<PollEligibilityEnrollmentList> {
    return this.http.get<PollEligibilityEnrollmentList>(`/api/admin/polls/${id}/eligibility-enrollments`);
  }

  addPollEligibilityEnrollments(
    id: string,
    request: AddPollEligibilityEnrollmentsRequest,
  ): Observable<PollEligibilityEnrollmentImportResult> {
    return this.http.post<PollEligibilityEnrollmentImportResult>(
      `/api/admin/polls/${id}/eligibility-enrollments`,
      request,
    );
  }

  importPollEligibilityEnrollments(
    id: string,
    request: ImportPollEligibilityEnrollmentsRequest,
  ): Observable<PollEligibilityEnrollmentImportResult> {
    return this.http.put<PollEligibilityEnrollmentImportResult>(
      `/api/admin/polls/${id}/eligibility-enrollments/import`,
      request,
    );
  }

  deletePollEligibilityEnrollment(id: string, enrollmentNumber: string): Observable<void> {
    return this.http.delete<void>(
      `/api/admin/polls/${id}/eligibility-enrollments/${encodeURIComponent(enrollmentNumber)}`,
    );
  }

  clearPollEligibilityEnrollments(id: string): Observable<PollEligibilityEnrollmentList> {
    return this.http.delete<PollEligibilityEnrollmentList>(`/api/admin/polls/${id}/eligibility-enrollments`);
  }

  getAdminPoll(id: string): Observable<Poll> {
    return this.http.get<Poll>(`/api/admin/polls/${id}`);
  }

  getAdminPollResults(id: string): Observable<PollResults> {
    return this.http.get<PollResults>(`/api/admin/polls/${id}/results`);
  }

  exportCacicElectionVoterEnrollments(id: string): Observable<Blob> {
    return this.http.get(`/api/admin/polls/${id}/cacic-election/voter-enrollments.txt`, {
      responseType: 'blob',
    });
  }

  listAdminCacicElectionSlates(id: string): Observable<AdminCacicElectionSlate[]> {
    return this.http.get<AdminCacicElectionSlate[]>(`/api/admin/polls/${id}/cacic-election/slates`);
  }

  createAdminCacicElectionSlate(
    id: string,
    request: UpdateCacicElectionSlateRequest,
  ): Observable<AdminCacicElectionSlate> {
    return this.http.post<AdminCacicElectionSlate>(`/api/admin/polls/${id}/cacic-election/slates`, request);
  }

  updateAdminCacicElectionSlate(
    id: string,
    slateId: string,
    request: UpdateCacicElectionSlateRequest,
  ): Observable<AdminCacicElectionSlate> {
    return this.http.put<AdminCacicElectionSlate>(
      `/api/admin/polls/${id}/cacic-election/slates/${encodeURIComponent(slateId)}`,
      request,
    );
  }

  rejectCacicElectionSlate(
    id: string,
    slateId: string,
    request: RejectCacicElectionSlateRequest,
  ): Observable<AdminCacicElectionSlate> {
    return this.http.patch<AdminCacicElectionSlate>(
      `/api/admin/polls/${id}/cacic-election/slates/${encodeURIComponent(slateId)}/rejection`,
      request,
    );
  }

  updateCacicElectionSlateEnabled(
    id: string,
    slateId: string,
    request: UpdateCacicElectionSlateEnabledRequest,
  ): Observable<AdminCacicElectionSlate> {
    return this.http.patch<AdminCacicElectionSlate>(
      `/api/admin/polls/${id}/cacic-election/slates/${encodeURIComponent(slateId)}/enabled`,
      request,
    );
  }

  deleteCacicElectionSlate(id: string, slateId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/admin/polls/${id}/cacic-election/slates/${encodeURIComponent(slateId)}`,
    );
  }

  getPublicPollResults(id: string): Observable<PollResults> {
    return this.http.get<PollResults>(`/api/polls/${id}/results`);
  }

  getDirectLinkPollResults(directLinkToken: string): Observable<PollResults> {
    return this.http.get<PollResults>(`/api/polls/direct/${encodeURIComponent(directLinkToken)}/results`);
  }

  openAdminPollResultsEvents(id: string, after: number): EventSource {
    return this.openResultsEvents(`/api/admin/polls/${encodeURIComponent(id)}/results/events`, after);
  }

  openPublicPollResultsEvents(id: string, after: number): EventSource {
    return this.openResultsEvents(`/api/polls/${encodeURIComponent(id)}/results/events`, after);
  }

  openDirectLinkPollResultsEvents(directLinkToken: string, after: number): EventSource {
    return this.openResultsEvents(
      `/api/polls/direct/${encodeURIComponent(directLinkToken)}/results/events`,
      after,
    );
  }

  createPoll(request: SavePollRequest): Observable<Poll> {
    return this.http.post<Poll>('/api/admin/polls', request);
  }

  updatePoll(id: string, request: SavePollRequest): Observable<Poll> {
    return this.http.put<Poll>(`/api/admin/polls/${id}`, request);
  }

  uploadPollImage(id: string, file: File): Observable<PollImage> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<PollImage>(`/api/admin/polls/${id}/images`, formData);
  }

  deletePollImage(id: string, imageId: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/polls/${id}/images/${imageId}`);
  }

  updatePollStatus(id: string, status: PollStatus): Observable<Poll> {
    return this.http.patch<Poll>(`/api/admin/polls/${id}/status`, { status });
  }

  deletePoll(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/polls/${id}`);
  }

  parseResultsDelta(event: MessageEvent<string>): PollResultsDelta | null {
    try {
      return JSON.parse(event.data) as PollResultsDelta;
    } catch {
      return null;
    }
  }

  private openResultsEvents(path: string, after: number): EventSource {
    const url = new URL(path, globalThis.location.origin);
    url.searchParams.set('after', String(Math.max(0, after)));
    return new EventSource(url, { withCredentials: true });
  }
}
