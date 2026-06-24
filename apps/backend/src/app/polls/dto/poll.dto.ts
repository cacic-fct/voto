import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POLL_ELEMENT_TYPES,
  POLL_ELIGIBILITY_IMPORT_FORMATS,
  POLL_ELIGIBILITY_MUTATION_MODES,
  POLL_SCHEDULING_INVITEE_MODES,
  POLL_STATUSES,
  POLL_VOTER_ELIGIBILITY_SOURCES,
  POLL_VOTING_STYLES,
  PollEligibilityImportFormat,
  PollEligibilityMutationMode,
  PollAnswerValue,
  PollElementSettings,
  PollElementType,
  PollImageReference,
  PollSchedulingAvailabilityWindow,
  PollSchedulingInviteeMode,
  PollSchedulingSettings,
  PollStatus,
  PollVoterEligibilitySource,
  PollVotingStyle,
} from '@org/voting-contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PollChoiceOptionDto {
  @ApiProperty({ example: 'option-1' })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiProperty({ example: 'Chapa Aurora' })
  @IsString()
  @MaxLength(240)
  label!: string;

  @ApiPropertyOptional({ example: 'Representantes do curso de Ciência da Computação.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class PollGridSettingsDto {
  @ApiProperty({ type: [PollChoiceOptionDto] })
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => PollChoiceOptionDto)
  rows!: PollChoiceOptionDto[];

  @ApiProperty({ type: [PollChoiceOptionDto] })
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => PollChoiceOptionDto)
  columns!: PollChoiceOptionDto[];
}

export class PollLinearScaleSettingsDto {
  @ApiProperty({ enum: [0, 1], example: 1 })
  @IsInt()
  @Min(0)
  @Max(1)
  min!: 0 | 1;

  @ApiProperty({ minimum: 2, maximum: 10, example: 5 })
  @IsInt()
  @Min(2)
  @Max(10)
  max!: number;

  @ApiPropertyOptional({ example: 'Discordo totalmente' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  minLabel?: string;

  @ApiPropertyOptional({ example: 'Concordo totalmente' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  maxLabel?: string;
}

export class PollStarRatingSettingsDto {
  @ApiProperty({ minimum: 3, maximum: 10, example: 5 })
  @IsInt()
  @Min(3)
  @Max(10)
  max!: number;
}

export class PollSchedulingAvailabilityWindowDto implements PollSchedulingAvailabilityWindow {
  @ApiProperty({ example: 'availability-1' })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiProperty({ example: '2026-06-24' })
  @IsString()
  @MaxLength(10)
  date!: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @MaxLength(5)
  startTime!: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  @MaxLength(5)
  endTime!: string;
}

export class PollSchedulingSettingsDto implements PollSchedulingSettings {
  @ApiPropertyOptional({ example: 'Centro Acadêmico da Computação' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  hostName?: string;

  @ApiPropertyOptional({ example: 'Google Meet ou sala 12' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  location?: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  @IsString()
  @MaxLength(80)
  timezone!: string;

  @ApiProperty({ minimum: 5, maximum: 480, example: 30 })
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes!: number;

  @ApiProperty({ minimum: 5, maximum: 180, example: 30 })
  @IsInt()
  @Min(5)
  @Max(180)
  slotIntervalMinutes!: number;

  @ApiProperty({ minimum: 0, maximum: 120, example: 0 })
  @IsInt()
  @Min(0)
  @Max(120)
  bufferBeforeMinutes!: number;

  @ApiProperty({ minimum: 0, maximum: 120, example: 0 })
  @IsInt()
  @Min(0)
  @Max(120)
  bufferAfterMinutes!: number;

  @ApiProperty({ enum: POLL_SCHEDULING_INVITEE_MODES, example: 'optional' })
  @IsIn(POLL_SCHEDULING_INVITEE_MODES)
  inviteeMode!: PollSchedulingInviteeMode;

  @ApiProperty({ minimum: 0, maximum: 20, example: 3 })
  @IsInt()
  @Min(0)
  @Max(20)
  maxInvitees!: number;

  @ApiProperty({ type: [PollSchedulingAvailabilityWindowDto] })
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => PollSchedulingAvailabilityWindowDto)
  availability!: PollSchedulingAvailabilityWindowDto[];
}

export class PollElementSettingsDto implements PollElementSettings {
  @ApiPropertyOptional({ type: PollGridSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PollGridSettingsDto)
  grid?: PollGridSettingsDto;

  @ApiPropertyOptional({ type: PollLinearScaleSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PollLinearScaleSettingsDto)
  linearScale?: PollLinearScaleSettingsDto;

  @ApiPropertyOptional({ type: PollStarRatingSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PollStarRatingSettingsDto)
  starRating?: PollStarRatingSettingsDto;

  @ApiPropertyOptional({ type: PollSchedulingSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PollSchedulingSettingsDto)
  scheduling?: PollSchedulingSettingsDto;
}

export class PollImageReferenceDto implements PollImageReference {
  @ApiProperty({ example: 'clx7q8x3a0000jv08n7v1fb13' })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiPropertyOptional({ example: 'Foto da chapa candidata no auditório.' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  altText?: string;

  @ApiPropertyOptional({ example: 'Registro enviado pela comissão eleitoral.' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  caption?: string;
}

export class PollElementDto {
  @ApiProperty({ example: 'question-1' })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiProperty({ enum: POLL_ELEMENT_TYPES, example: 'singleChoice' })
  @IsIn(POLL_ELEMENT_TYPES)
  type!: PollElementType;

  @ApiProperty({ example: 'Escolha uma opção' })
  @IsString()
  @MaxLength(240)
  title!: string;

  @ApiPropertyOptional({ example: 'Seu voto será contabilizado ao final da votação.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [PollImageReferenceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PollImageReferenceDto)
  descriptionImages?: PollImageReferenceDto[];

  @ApiProperty({ example: true })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ type: [PollChoiceOptionDto] })
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => PollChoiceOptionDto)
  options!: PollChoiceOptionDto[];

  @ApiPropertyOptional({ type: PollElementSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PollElementSettingsDto)
  settings?: PollElementSettingsDto;
}

export class SavePollDto {
  @ApiProperty({ example: 'Eleição do Centro Acadêmico' })
  @IsString()
  @MaxLength(240)
  title!: string;

  @ApiPropertyOptional({ example: 'Formulário de votação para representantes discentes.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ type: [PollImageReferenceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PollImageReferenceDto)
  descriptionImages?: PollImageReferenceDto[];

  @ApiPropertyOptional({ enum: POLL_STATUSES, example: 'draft' })
  @IsOptional()
  @IsIn(POLL_STATUSES)
  status?: PollStatus;

  @ApiPropertyOptional({ enum: POLL_VOTING_STYLES, example: 'secret' })
  @IsOptional()
  @IsIn(POLL_VOTING_STYLES)
  votingStyle?: PollVotingStyle;

  @ApiPropertyOptional({ enum: POLL_VOTER_ELIGIBILITY_SOURCES, example: 'authenticatedUsers' })
  @IsOptional()
  @IsIn(POLL_VOTER_ELIGIBILITY_SOURCES)
  voterEligibilitySource?: PollVoterEligibilitySource;

  @ApiPropertyOptional({
    example: false,
    description:
      'When computer-science students are selected, require the Keycloak Unesp role verification from Account Manager document validation.',
  })
  @IsOptional()
  @IsBoolean()
  requireVerifiedUnespRole?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Allow authenticated users with the shareable direct link to vote even when other eligibility rules do not match.',
  })
  @IsOptional()
  @IsBoolean()
  directLinkEnabled?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Allow voters to see public poll results according to the live-results setting.',
  })
  @IsOptional()
  @IsBoolean()
  resultsPublic?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'When public results are enabled, allow voters to see results while voting is still open.',
  })
  @IsOptional()
  @IsBoolean()
  resultsLive?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Allow voters to edit their submitted response. Disabled for anonymous polls.',
  })
  @IsOptional()
  @IsBoolean()
  allowResponseEditing?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Allow the same voter to submit more than one response.',
  })
  @IsOptional()
  @IsBoolean()
  allowMultipleResponses?: boolean;

  @ApiPropertyOptional({ example: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  linkedEventId?: string;

  @ApiProperty({ type: [PollElementDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PollElementDto)
  elements!: PollElementDto[];
}

export class PollStatusDto {
  @ApiProperty({ enum: POLL_STATUSES, example: 'published' })
  @IsIn(POLL_STATUSES)
  status!: PollStatus;
}

export class PollResponseAnswerDto {
  @ApiProperty({ example: 'question-1' })
  @IsString()
  @MaxLength(128)
  elementId!: string;

  @ApiProperty({
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'array', items: { type: 'string' } },
      { type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] } },
      { type: 'null' },
    ],
    example: 'option-1',
  })
  @Allow()
  value!: PollAnswerValue;
}

export class SubmitPollResponseDto {
  @ApiProperty({ type: [PollResponseAnswerDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PollResponseAnswerDto)
  answers!: PollResponseAnswerDto[];
}

export class AddPollEligibilityEnrollmentsDto {
  @ApiProperty({
    example: ['20240001', '20240002'],
    type: [String],
    description: 'Enrollment numbers that should be allowed to vote in this poll.',
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  enrollmentNumbers!: string[];
}

export class ImportPollEligibilityEnrollmentsDto {
  @ApiProperty({ enum: POLL_ELIGIBILITY_IMPORT_FORMATS, example: 'csv' })
  @IsIn(POLL_ELIGIBILITY_IMPORT_FORMATS)
  format!: PollEligibilityImportFormat;

  @ApiProperty({
    example: 'matricula,nome\n20240001,Ada Lovelace',
    description: 'Raw TXT or CSV content selected in the admin frontend.',
  })
  @IsString()
  @MaxLength(5_000_000)
  content!: string;

  @ApiPropertyOptional({ enum: POLL_ELIGIBILITY_MUTATION_MODES, example: 'append' })
  @IsOptional()
  @IsIn(POLL_ELIGIBILITY_MUTATION_MODES)
  mode?: PollEligibilityMutationMode;

  @ApiPropertyOptional({
    example: 'matricula',
    description: 'Required for CSV imports and ignored for TXT imports.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  selectedHeader?: string;

  @ApiPropertyOptional({ example: 'habilitados.csv' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
