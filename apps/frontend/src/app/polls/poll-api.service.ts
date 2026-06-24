import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AddPollEligibilityEnrollmentsRequest,
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
  SavePollRequest,
  SubmitPollResponseRequest,
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
