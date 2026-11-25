import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** The largest value of a Postgres `INT`: a version is stored in one. */
export const MAX_VERSION = 2_147_483_647;

/** A version number in a path: a whole number from 1 to 2,147,483,647, else 400. */
@Injectable()
export class ParseVersionPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (typeof value !== 'string' || !/^[0-9]{1,10}$/.test(value)) {
      throw new BadRequestException('The version must be a whole number.');
    }
    const version = Number(value);
    if (version < 1 || version > MAX_VERSION) {
      throw new BadRequestException(`The version must be between 1 and ${MAX_VERSION}.`);
    }
    return version;
  }
}
