import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { faNumber } from "../lib/format.js";

export function AdminPagination({ page, pageCount, total, onPage }: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, pageCount);
  const currentPage = Math.min(page, lastPage);
  return <nav className="admin-pagination" aria-label="صفحه‌بندی فهرست">
    <span>{faNumber(total)} نتیجه · صفحهٔ {faNumber(currentPage)} از {faNumber(lastPage)}</span>
    <div>
      <button className="admin-icon-action" type="button" disabled={currentPage <= 1} onClick={() => onPage(1)} aria-label="صفحهٔ اول" title="صفحهٔ اول"><ChevronsRight size={17} /></button>
      <button className="admin-icon-action" type="button" disabled={currentPage <= 1} onClick={() => onPage(currentPage - 1)} aria-label="صفحهٔ قبل" title="صفحهٔ قبل"><ChevronRight size={17} /></button>
      <button className="admin-icon-action" type="button" disabled={currentPage >= lastPage} onClick={() => onPage(currentPage + 1)} aria-label="صفحهٔ بعد" title="صفحهٔ بعد"><ChevronLeft size={17} /></button>
      <button className="admin-icon-action" type="button" disabled={currentPage >= lastPage} onClick={() => onPage(lastPage)} aria-label="صفحهٔ آخر" title="صفحهٔ آخر"><ChevronsLeft size={17} /></button>
    </div>
  </nav>;
}
