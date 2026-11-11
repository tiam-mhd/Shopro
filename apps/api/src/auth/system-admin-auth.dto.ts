import { IsString, MaxLength } from "class-validator";

export class SystemAdminLoginDto {
  @IsString() @MaxLength(40) username!: string;
  @IsString() @MaxLength(1024) password!: string;
}

export class SystemAdminChangePasswordDto {
  @IsString() @MaxLength(1024) currentPassword!: string;
  @IsString() @MaxLength(1024) newPassword!: string;
  @IsString() @MaxLength(1024) confirmPassword!: string;
}

export class SystemAdminRevokeSessionsDto {
  @IsString() @MaxLength(1024) currentPassword!: string;
}
