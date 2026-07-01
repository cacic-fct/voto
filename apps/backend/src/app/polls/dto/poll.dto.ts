import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CACIC_ELECTION_PHASES,
  CACIC_ELECTION_SLATE_MEMBER_IDENTIFIER_TYPES,
  CACIC_ELECTION_SLATE_MEMBER_ROLES,
  CACIC_ELECTION_SLATE_STATUSES,
  POLL_ELEMENT_TYPES,
  POLL_ELIGIBILITY_IMPORT_FORMATS,
  POLL_ELIGIBILITY_MUTATION_MODES,
  POLL_MODES,
  POLL_SCHEDULING_INVITEE_MODES,
  POLL_STATUSES,
  POLL_VOTER_ELIGIBILITY_SOURCES,
  POLL_VOTING_STYLES,
  CacicElectionPhase,
  CacicElectionSlateMemberIdentifierType,
  CacicElectionSlateMemberRole,
  CacicElectionSlateStatus,
  PollEligibilityImportFormat,
  PollEligibilityMutationMode,
  PollAnswerValue,
  PollElementSettings,
  PollElementType,
  PollImageReference,
  PollMode,
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
  IsISO8601,
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

  @ApiPropertyOptional({ enum: POLL_MODES, example: 'regular' })
  @IsOptional()
  @IsIn(POLL_MODES)
  mode?: PollMode;

  @ApiPropertyOptional({ enum: CACIC_ELECTION_PHASES, example: 'slateSubmission' })
  @IsOptional()
  @IsIn(CACIC_ELECTION_PHASES)
  cacicElectionPhase?: CacicElectionPhase;

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

  @ApiPropertyOptional({
    example: '2026-06-27T12:30:00.000Z',
    description: 'First instant when authenticated voters can see this poll in public routes.',
  })
  @IsOptional()
  @IsISO8601()
  visibleFrom?: string | null;

  @ApiPropertyOptional({
    example: '2026-06-27T13:00:00.000Z',
    description: 'First instant when voting responses are accepted.',
  })
  @IsOptional()
  @IsISO8601()
  votingStartsAt?: string | null;

  @ApiPropertyOptional({
    example: '2026-06-27T18:00:00.000Z',
    description: 'Instant when voting responses stop being accepted.',
  })
  @IsOptional()
  @IsISO8601()
  votingEndsAt?: string | null;

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

export class CacicElectionSlateMemberDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @MaxLength(240)
  fullName!: string;

  @ApiPropertyOptional({ example: '26123456' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  enrollmentNumber?: string;

  @ApiProperty({ enum: CACIC_ELECTION_SLATE_MEMBER_ROLES, example: 'president' })
  @IsIn(CACIC_ELECTION_SLATE_MEMBER_ROLES)
  role!: CacicElectionSlateMemberRole;

  @ApiPropertyOptional({ example: 'Diretoria de Projetos' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customRole?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isRepresentative!: boolean;

  @ApiProperty({ enum: CACIC_ELECTION_SLATE_MEMBER_IDENTIFIER_TYPES, example: 'email' })
  @IsIn(CACIC_ELECTION_SLATE_MEMBER_IDENTIFIER_TYPES)
  identifierType!: CacicElectionSlateMemberIdentifierType;

  @ApiProperty({ example: 'ada@example.com' })
  @IsString()
  @MaxLength(255)
  identifierValue!: string;
}

export class SubmitCacicElectionSlateDto {
  @ApiProperty({ example: 'Chapa Aurora' })
  @IsString()
  @MaxLength(240)
  name!: string;

  @ApiProperty({ type: [CacicElectionSlateMemberDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CacicElectionSlateMemberDto)
  members!: CacicElectionSlateMemberDto[];
}

export class UpdateCacicElectionSlateDto extends SubmitCacicElectionSlateDto {
  @ApiPropertyOptional({ enum: CACIC_ELECTION_SLATE_STATUSES, example: 'approved' })
  @IsOptional()
  @IsIn(CACIC_ELECTION_SLATE_STATUSES)
  status?: CacicElectionSlateStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class RejectCacicElectionSlateDto {
  @ApiProperty({ example: 'A chapa não contemplou todos os cargos obrigatórios.' })
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class UpdateCacicElectionSlateEnabledDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  enabled!: boolean;
}
