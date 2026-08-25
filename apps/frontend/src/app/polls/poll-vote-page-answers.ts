import { MatCheckboxChange } from '@angular/material/checkbox';
import { formatDateOnly, parseDateOnly } from '../shared/date-only';
import { MatRadioChange } from '@angular/material/radio';
import { MatSelectChange } from '@angular/material/select';
import { PollElement } from '@org/voting-contracts';
import {
  AnswerValue,
  gridTemplateColumns,
  isMultipleAnswerSelected,
  isMultipleGridColumnSelected,
  isNumberAnswerSelected,
  isRatingFilled,
  isRatingValueSelected,
  isSingleAnswerSelected,
  isSingleGridColumnSelected,
  linearScaleValues,
  range,
  ratingOptionLabel,
  readMultipleGridAnswer,
  readSingleGridAnswer,
  setAnswerValue,
  setSingleGridAnswerValue,
  singleAnswerValue,
  starRatingValues,
  textAnswerValue,
  toggleMultipleAnswerValue,
  toggleMultipleGridAnswerValue,
} from './poll-vote-answer-state';
import { PollVotePageState } from './poll-vote-page-state';

export abstract class PollVotePageAnswers extends PollVotePageState {
  protected setTextAnswer(elementId: string, event: Event): void {
    const target = event.target;
    const value =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
        ? target.value
        : '';
    this.answers.update((answers) => setAnswerValue(answers, elementId, value));
  }

  protected setDateAnswer(elementId: string, value: Date | null): void {
    this.answers.update((answers) => setAnswerValue(answers, elementId, formatDateOnly(value)));
  }

  protected setSingleAnswer(elementId: string, event: MatRadioChange): void {
    this.answers.update((answers) =>
      setAnswerValue(answers, elementId, String(event.value)),
    );
  }

  protected setDropdownAnswer(elementId: string, event: MatSelectChange): void {
    this.answers.update((answers) =>
      setAnswerValue(answers, elementId, String(event.value)),
    );
  }

  protected setNumberAnswer(elementId: string, value: number): void {
    this.answers.update((answers) => setAnswerValue(answers, elementId, value));
  }

  protected toggleMultipleAnswer(
    elementId: string,
    optionId: string,
    event: MatCheckboxChange,
  ): void {
    this.answers.update((answers) =>
      toggleMultipleAnswerValue(answers, elementId, optionId, event.checked),
    );
  }

  protected setSingleGridAnswer(
    elementId: string,
    rowId: string,
    columnId: string,
  ): void {
    this.answers.update((answers) =>
      setSingleGridAnswerValue(answers, elementId, rowId, columnId),
    );
  }

  protected toggleMultipleGridAnswer(
    elementId: string,
    rowId: string,
    columnId: string,
    event: MatCheckboxChange,
  ): void {
    this.answers.update((answers) =>
      toggleMultipleGridAnswerValue(
        answers,
        elementId,
        rowId,
        columnId,
        event.checked,
      ),
    );
  }

  protected linearScaleValues(element: PollElement): number[] {
    return linearScaleValues(element);
  }

  protected starRatingValues(element: PollElement): number[] {
    return starRatingValues(element);
  }

  protected isNumberAnswerSelected(elementId: string, value: number): boolean {
    return isNumberAnswerSelected(this.answers(), elementId, value);
  }

  protected textAnswerValue(elementId: string): string {
    return textAnswerValue(this.answers(), elementId);
  }

  protected dateAnswerValue(elementId: string): Date | null {
    return parseDateOnly(textAnswerValue(this.answers(), elementId));
  }

  protected singleAnswerValue(elementId: string): string {
    return singleAnswerValue(this.answers(), elementId);
  }

  protected isSingleAnswerSelected(
    elementId: string,
    optionId: string,
  ): boolean {
    return isSingleAnswerSelected(this.answers(), elementId, optionId);
  }

  protected isMultipleAnswerSelected(
    elementId: string,
    optionId: string,
  ): boolean {
    return isMultipleAnswerSelected(this.answers(), elementId, optionId);
  }

  protected isRatingFilled(elementId: string, value: number): boolean {
    return isRatingFilled(this.answers(), elementId, value);
  }

  protected isRatingValueSelected(elementId: string, value: number): boolean {
    return isRatingValueSelected(this.answers(), elementId, value);
  }

  protected ratingOptionLabel(elementId: string, value: number): string {
    return ratingOptionLabel(this.answers(), elementId, value);
  }

  protected isSingleGridColumnSelected(
    elementId: string,
    rowId: string,
    columnId: string,
  ): boolean {
    return isSingleGridColumnSelected(
      this.answers(),
      elementId,
      rowId,
      columnId,
    );
  }

  protected isMultipleGridColumnSelected(
    elementId: string,
    rowId: string,
    columnId: string,
  ): boolean {
    return isMultipleGridColumnSelected(
      this.answers(),
      elementId,
      rowId,
      columnId,
    );
  }

  protected gridTemplateColumns(element: PollElement): string {
    return gridTemplateColumns(element);
  }

  private range(min: number, max: number): number[] {
    return range(min, max);
  }

  private readSingleGridAnswer(
    value: AnswerValue | undefined,
  ): Record<string, string> {
    return readSingleGridAnswer(value);
  }

  private readMultipleGridAnswer(
    value: AnswerValue | undefined,
  ): Record<string, string[]> {
    return readMultipleGridAnswer(value);
  }
}
