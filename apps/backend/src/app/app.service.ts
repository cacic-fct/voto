import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getData(): { status: string; name: string } {
    return { status: 'ok', name: 'CACiC Voto API' };
  }
}
