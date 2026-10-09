import { SetMetadata } from '@nestjs/common';
import { SKIP_SESSION_AUTHENTICATION_KEY } from '../auth.constants';

export const SkipSessionAuthentication = () =>
  SetMetadata(SKIP_SESSION_AUTHENTICATION_KEY, true);
