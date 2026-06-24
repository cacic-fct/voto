import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PollImage } from '@org/voting-contracts';

@Component({
  selector: 'app-poll-description-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    @if (text(); as descriptionText) {
      <p class="description-text">{{ descriptionText }}</p>
    }

    @for (image of images(); track image.id) {
      <figure class="description-image">
        <img
          [ngSrc]="image.url"
          [width]="image.width"
          [height]="image.height"
          [alt]="image.altText || ''" />
        @if (image.caption) {
          <figcaption>{{ image.caption }}</figcaption>
        }
      </figure>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.75rem;
    }

    .description-text {
      margin: 0;
      white-space: pre-line;
    }

    .description-image {
      display: grid;
      gap: 0.375rem;
      margin: 0;
    }

    .description-image img {
      display: block;
      width: min(100%, var(--description-preview-width, 52rem));
      height: auto;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-highest);
      object-fit: contain;
    }

    figcaption {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class PollDescriptionContentComponent {
  readonly text = input<string | undefined>();
  readonly images = input<readonly PollImage[]>([]);
}
