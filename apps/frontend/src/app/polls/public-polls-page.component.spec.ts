import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PollSummary } from '@org/voting-contracts';
import { of, throwError } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PollApiService } from './poll-api.service';
import { PublicPollsPageComponent } from './public-polls-page.component';

describe('PublicPollsPageComponent', () => {
  let fixture: ComponentFixture<PublicPollsPageComponent>;
  let api: Pick<PollApiService, 'listPublicPolls'>;

  const polls: PollSummary[] = [
    {
      id: 'poll-1',
      title: 'Eleição CACiC',
      description: 'Escolha a próxima gestão.',
      status: 'published',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      publishedAt: '2026-06-01T10:00:00.000Z',
      votingStyle: 'secret',
      voterEligibilitySource: 'authenticatedUsers',
      requireVerifiedUnespRole: false,
      directLinkEnabled: false,
      resultsPublic: false,
      resultsLive: false,
      allowResponseEditing: false,
      allowMultipleResponses: false,
      elementCount: 2,
      responseCount: 12,
    },
  ];

  beforeEach(async () => {
    api = {
      listPublicPolls: vi.fn().mockReturnValue(of(polls)),
    };

    await TestBed.configureTestingModule({
      imports: [PublicPollsPageComponent],
      providers: [provideRouter([]), { provide: PollApiService, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicPollsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render published polls', () => {
    expect(api.listPublicPolls).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Eleição CACiC');
    expect(fixture.nativeElement.textContent).toContain('12 respostas');
  });

  it('should label closed, dated, and undated poll statuses', () => {
    const component = fixture.componentInstance as unknown as {
      pollStatusLabel(poll: PollSummary): string;
    };

    expect(component.pollStatusLabel({ ...polls[0], status: 'closed' })).toBe('Encerrada');
    expect(component.pollStatusLabel({ ...polls[0], publishedAt: undefined })).toBe('Publicada');
    expect(component.pollStatusLabel(polls[0])).toContain('Publicada em');
  });

  it('should show a localized error when public polls fail to load', async () => {
    TestBed.resetTestingModule();
    api = {
      listPublicPolls: vi.fn().mockReturnValue(throwError(() => new Error('offline'))),
    };

    await TestBed.configureTestingModule({
      imports: [PublicPollsPageComponent],
      providers: [provideRouter([]), { provide: PollApiService, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicPollsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Não foi possível carregar as votações.');
  });
});
