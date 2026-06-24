import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { type CookieBannerOptions } from '@cacic-fct/account-manager-cookie-banner';
import { CookieBannerFeatureFlagService } from './feature-flags/cookie-banner-feature-flag.service';
import { PackageCookieBannerComponent } from './privacy/package-cookie-banner.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, PackageCookieBannerComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly cookieBannerFeatureFlag = inject(CookieBannerFeatureFlagService);

  protected readonly title = 'CACiC Voto';
  protected readonly cookieBannerEnabled = this.cookieBannerFeatureFlag.enabled;
  protected readonly cookieBannerConfig: CookieBannerOptions = {
    privacyPolicyUrl: 'https://cacic.dev.br/legal/privacy-policy',
    onAccept: () => {
      window.dispatchEvent(new Event('cookieBannerAccepted'));
    },
  };
}
