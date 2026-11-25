import { BadRequestException, HttpStatus, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** One refused field: `field` is the path in the body (`meals.0.portions`). */
export interface FieldError {
  field: string;
  /** The class-validator rule that failed (`isLength`, `whitelistValidation`…). */
  code: string;
  message: string;
}

/** Walks class-validator's tree into one entry per failed rule. */
export function fieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.entries(error.constraints ?? {}).map(([code, message]) => ({
        field,
        code,
        message,
      })),
      ...fieldErrors(error.children ?? [], field),
    ];
  });
}

/**
 * The global pipe: Nest's 400 unchanged (`message` stays the array of sentences),
 * plus `code: VALIDATION_FAILED` and `errors[]`, so a form can point at the field
 * without parsing English.
 */
export class ApiValidationPipe extends ValidationPipe {
  createExceptionFactory() {
    return (errors: ValidationError[] = []) =>
      new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'VALIDATION_FAILED',
        message: this.flattenValidationErrors(errors),
        errors: fieldErrors(errors),
      });
  }
}
