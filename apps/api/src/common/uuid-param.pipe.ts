import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string | undefined, message = "شناسهٔ درخواست معتبر نیست.") {
  if (value !== undefined && !UUID_PATTERN.test(value)) throw new BadRequestException(message);
}

@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string) {
    assertUuid(value);
    return value;
  }
}
