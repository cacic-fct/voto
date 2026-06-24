import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { AuthenticatedUser } from '@org/voting-contracts';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { AppShellComponent } from './app-shell.component';

@Component({
  template: '',
})
class DummyRouteComponent {}

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let auth: Pick<AuthService, 'user' | 'logout'>;
  let isAdmin: ReturnType<typeof signal<boolean>>;

  const user: AuthenticatedUser = {
    email: 'admin@cacic.test',
    roles: [],
    permissions: [],
    scopes: [],
    oidcScopes: [],
    claims: {},
  };

  beforeEach(async () => {
    isAdmin = signal(false);
    auth = {
      user: signal(user),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([{ path: 'polls', component: DummyRouteComponent }]),
        { provide: AuthService, useValue: auth },
        {
          provide: PermissionsService,
          useValue: {
            isAdmin,
            evaluateAdminPermissions: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should only show the public voting tab by default', () => {
    expect(fixture.nativeElement.textContent).toContain('Votações');
    expect(fixture.nativeElement.textContent).not.toContain('Área restrita');
  });

  it('should show the restricted area tab for admins', () => {
    isAdmin.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Área restrita');
  });

  it('should detect active routes and forward logout to the auth service', async () => {
    const component = fixture.componentInstance as unknown as {
      isActive(path: string): boolean;
      logout(): Promise<void>;
    };

    expect(component.isActive('/')).toBe(true);

    await component.logout();

    expect(auth.logout).toHaveBeenCalled();
  });

  it('should react to router navigation events when computing active tabs', async () => {
    const component = fixture.componentInstance as unknown as {
      isActive(path: string): boolean;
    };

    await TestBed.inject(Router).navigateByUrl('/polls');
    fixture.detectChanges();

    expect(component.isActive('/polls')).toBe(true);
  });
});
