import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches, MaxLength } from 'class-validator';

export class AuthorizePollKioskVoteDto {
  @ApiProperty({
    description: 'Primary email address registered in CACiC Account Manager.',
    example: 'eleitor@unesp.br',
    maxLength: 254,
  })
  @IsEmail()
  @MaxLength(254)
  primaryEmail!: string;

  @ApiProperty({
    description: 'Six-digit TOTP generated from the voter Account Manager seed.',
    example: '123456',
    pattern: '^\\d{6}$',
  })
  @Matches(/^\d{6}$/)
  totpCode!: string;
}
