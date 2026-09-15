export const CREATOR_TYPE_LABEL: Record<string, string> = {
  WRITER: "Writer", DIRECTOR: "Director", WRITER_DIRECTOR: "Writer / Director", PRODUCER: "Producer", CREATOR: "Creator", OTHER: "Other",
};
export const typeLabel = (t: string) => CREATOR_TYPE_LABEL[t] ?? t;

export const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "Story submitted", ASSIGN: "Assigned", FORWARD: "Forwarded", ACCEPT: "Accepted & recommended", REJECT: "Rejected",
  REQUEST_CHANGES: "Changes requested", HOLD: "Put on hold", RESUME: "Resumed", APPROVE: "Approved", SEND_TO_PLATFORM: "Approved for platform pitching",
  SEND_BACK: "Sent back for review", RECORD_PLATFORM_PITCH: "Pitched to platform", MARK_PLATFORM_APPROVED: "Platform approved",
  MARK_READY_FOR_DEVELOPMENT: "Ready for development", START_DEVELOPMENT: "Development started", GREENLIGHT: "Greenlit", ADVANCE: "Moved forward", REOPEN: "Reopened",
};

export const PLATFORM_STATUS_LABEL: Record<string, string> = {
  NOT_YET_PITCHED: "Not yet pitched", PITCHED: "Pitched", AWAITING_RESPONSE: "Awaiting response", INTERESTED: "Interested",
  MEETING_REQUESTED: "Meeting requested", REQUESTED_CHANGES: "Requested changes", SECOND_DRAFT_REQUESTED: "Second draft requested",
  APPROVED: "Approved", REJECTED: "Rejected", ON_HOLD: "On hold", DEVELOPMENT_DISCUSSION: "Development discussion",
  READY_FOR_DEVELOPMENT: "Ready for development", GREENLIT: "Greenlit",
};
