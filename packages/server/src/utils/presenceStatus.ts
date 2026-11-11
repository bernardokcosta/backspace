import { isChosenUserStatus, type ChosenUserStatus } from '@veyvox/shared';

/** The stored local choice survives live-status reset and disconnect. Pure so
 * the socket auth path can use it without a database/connection import cycle. */
export interface StatusSourceRow { chosenStatus: string }

export function statusOnConnect(row: StatusSourceRow): ChosenUserStatus {
  return isChosenUserStatus(row.chosenStatus) ? row.chosenStatus : 'online';
}
