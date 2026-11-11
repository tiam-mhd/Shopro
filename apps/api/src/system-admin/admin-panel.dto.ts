import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateBusinessStatusDto {
  @IsBoolean() isActive!: boolean;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsString() @MaxLength(1024) currentPassword!: string;
}

export class CreateBusinessAdminNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) note!: string;
}

export class AdminListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsString() @MaxLength(80) paymentStatus?: string;
  @IsOptional() @IsString() @MaxLength(80) sort?: string;
  @IsOptional() @IsString() @MaxLength(8) direction?: string;
  @IsOptional() @IsString() @MaxLength(32) from?: string;
  @IsOptional() @IsString() @MaxLength(32) to?: string;
  @IsOptional() @IsString() @MaxLength(24) minTotal?: string;
  @IsOptional() @IsString() @MaxLength(24) maxTotal?: string;
  @IsOptional() @IsString() @MaxLength(24) planCode?: string;
  @IsOptional() @IsString() @MaxLength(8) minBranches?: string;
  @IsOptional() @IsString() @MaxLength(8) maxBranches?: string;
  @IsOptional() @IsString() @MaxLength(12) page?: string;
  @IsOptional() @IsString() @MaxLength(4) pageSize?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(80) entityType?: string;
}
