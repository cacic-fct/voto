import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';

type NavItem = {
  path: string;
  label: string;
  icon: string;
};

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, MatButtonModule, MatIconModule, MatToolbarModule],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly navItems = computed<NavItem[]>(() => [
    { path: '/polls', label: 'Votações', icon: 'ballot' },
    ...(this.permissions.isAdmin()
      ? [{ path: '/admin', label: 'Área restrita', icon: 'admin_panel_settings' }]
      : []),
  ]);

  constructor() {
    void this.permissions.evaluateAdminPermissions();
  }

  protected isActive(path: string): boolean {
    return this.currentUrl().startsWith(path);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
  }
}
