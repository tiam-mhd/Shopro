import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { MAX_ATTACHMENT_BYTES } from "./attachment-files.js";
import { CreateExpenseCategoryDto, CreateExpenseDto, PostExpenseDto, UpdateExpenseCategoryDto, VoidExpenseDto } from "./expenses.dto.js";
import { ExpensesService } from "./expenses.service.js";

type UploadedExpenseFile = { originalname: string; buffer: Buffer; size: number };

@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.expenses.list(user, cursor, limit); }
  @Get("categories") categories(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) { return this.expenses.categories(user, includeArchived === "true"); }
  @Post("categories") createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseCategoryDto, @Req() request: AppRequest) { return this.expenses.createCategory(user, dto, request); }
  @Patch("categories/:id") updateCategory(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateExpenseCategoryDto, @Req() request: AppRequest) { return this.expenses.updateCategory(user, id, dto, request); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.expenses.get(user, id); }
  @Post(":id/attachment") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0, parts: 1 }, preservePath: false })) uploadAttachment(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @UploadedFile() file: UploadedExpenseFile | undefined, @Req() request: AppRequest) { return this.expenses.uploadAttachment(user, id, file, request); }
  @Post(":id/attachment/download-token") issueAttachmentDownloadToken(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.expenses.issueAttachmentDownloadToken(user, id); }
  @Get(":id/attachment") async downloadAttachment(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Headers("x-attachment-download-token") token: string | undefined, @Res() response: Response) {
    const file = await this.expenses.downloadAttachment(user, id, token);
    const encodedName = encodeURIComponent(file.fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.set({ "Content-Type": file.mimeType, "Content-Length": String(file.bytes.byteLength), "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodedName}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    response.status(200).send(file.bytes);
  }
  @Delete(":id/attachment") removeAttachment(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Req() request: AppRequest) { return this.expenses.removeAttachment(user, id, request); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto, @Req() request: AppRequest) { return this.expenses.create(user, dto, request); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateExpenseDto, @Req() request: AppRequest) { return this.expenses.updateDraft(user, id, dto, request); }
  @Delete(":id") remove(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Req() request: AppRequest) { return this.expenses.deleteDraft(user, id, request); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: PostExpenseDto, @Headers("idempotency-key") key?: string, @Req() request?: AppRequest) { return this.expenses.post(user, id, dto, key, request); }
  @Post(":id/void") void(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: VoidExpenseDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.expenses.void(user, id, dto, key, request); }
}
