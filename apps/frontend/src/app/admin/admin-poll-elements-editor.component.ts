import { DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PollImage } from '@org/voting-contracts';
import { PollDescriptionContentComponent } from '../polls/poll-description-content.component';
import { PollBuilderDraftService } from './poll-builder-draft.service';

@Component({
  selector: 'app-admin-poll-elements-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    PollDescriptionContentComponent,
  ],
  templateUrl: './admin-poll-elements-editor.component.html',
  styleUrl: './admin-poll-builder-page.component.scss',
})
export class AdminPollElementsEditorComponent {
  readonly builder = input.required<PollBuilderDraftService>();
  readonly imageAccept = input.required<string>();
  readonly saving = input(false);
  readonly uploadingImageTarget = input<string | null>(null);
  readonly uploadImage = output<{ elementId: string; file: File | null }>();
  readonly removeImage = output<{ elementId: string; image: PollImage }>();

  protected isUploadingImage(target: string): boolean {
    return this.uploadingImageTarget() === target;
  }

  protected uploadElementDescriptionImage(elementId: string, file: File | null): void {
    this.uploadImage.emit({ elementId, file });
  }

  protected removeElementDescriptionImage(elementId: string, image: PollImage): void {
    this.removeImage.emit({ elementId, image });
  }
}
