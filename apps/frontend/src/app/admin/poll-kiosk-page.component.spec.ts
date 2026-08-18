import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { Poll } from '@org/voting-contracts';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PollApiService } from '../polls/poll-api.service';
import { PollKioskPageComponent } from './poll-kiosk-page.component';

describe('PollKioskPageComponent', () => {
  const poll: Poll = {
    id: 'poll-1',
    title: 'Assembleia CACiC',
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
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    elements: [],
  };
  let fixture: ComponentFixture<PollKioskPageComponent>;
  let api: {
    getAdminPoll: ReturnType<typeof vi.fn>;
    authorizeKioskVote: ReturnType<typeof vi.fn>;
  };
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    api = {
      getAdminPoll: vi.fn().mockReturnValue(of(poll)),
      authorizeKioskVote: vi.fn().mockReturnValue(
        of({
          poll,
          voter: {
            displayName: 'Pessoa Eleitora',
            maskedPrimaryEmail: 'pe***@example.com',
          },
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [PollKioskPageComponent],
      providers: [
        provideRouter([]),
        { provide: PollApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: vi.fn().mockReturnValue('poll-1') },
              queryParamMap: { get: vi.fn().mockReturnValue(null) },
            },
          },
        },
      ],
    }).compileComponents();
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    fixture = TestBed.createComponent(PollKioskPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads the selected poll and keeps voter credentials out of the URL', async () => {
    const component = fixture.componentInstance as unknown as {
      form: FormGroup;
      authorize(): Promise<void>;
    };
    component.form.setValue({
      primaryEmail: 'person@example.com',
      totpCode: '123456',
    });

    await component.authorize();

    expect(api.authorizeKioskVote).toHaveBeenCalledWith('poll-1', {
      primaryEmail: 'person@example.com',
      totpCode: '123456',
    });
    expect(navigate).toHaveBeenCalledWith(
      ['/admin/polls', 'poll-1', 'kiosk', 'vote'],
      { replaceUrl: true },
    );
    expect(JSON.stringify(navigate.mock.calls)).not.toContain(
      'person@example.com',
    );
    expect(JSON.stringify(navigate.mock.calls)).not.toContain('123456');
  });

  it('normalizes pasted TOTP text to six digits', () => {
    const component = fixture.componentInstance as unknown as {
      form: FormGroup;
      normalizeTotpCode(event: Event): void;
    };
    const input = document.createElement('input');
    input.value = '12 34-567';

    component.normalizeTotpCode({ target: input } as unknown as Event);

    expect(input.value).toBe('123456');
    expect(component.form.get('totpCode')?.value).toBe('123456');
  });

  it('clears the TOTP and shows a generic error after invalid credentials', async () => {
    api.authorizeKioskVote.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            statusText: 'Unauthorized',
          }),
      ),
    );
    const component = fixture.componentInstance as unknown as {
      form: FormGroup;
      error: { (): string | null };
      authorize(): Promise<void>;
    };
    component.form.setValue({
      primaryEmail: 'person@example.com',
      totpCode: '000000',
    });

    await component.authorize();

    expect(component.form.get('totpCode')?.value).toBe('');
    expect(component.error()).toBe('E-mail principal ou código TOTP inválido.');
    expect(navigate).not.toHaveBeenCalled();
  });
});
