import { IsString, Length, Matches } from "class-validator";

export class RequestOtpDto {
  @IsString() @Length(8, 16)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString() @Length(8, 16)
  phone!: string;

  @IsString() @Length(4, 8) @Matches(/^[0-9۰-۹٠-٩]+$/)
  code!: string;
}
