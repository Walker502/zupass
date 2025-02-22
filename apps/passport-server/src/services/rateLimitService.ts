import { ONE_DAY_MS, ONE_HOUR_MS } from "@pcd/util";
import {
  consumeRateLimitToken,
  deleteUnsupportedRateLimitBuckets,
  pruneRateLimitBuckets
} from "../database/queries/rateLimit";
import { ApplicationContext } from "../types";
import { logger } from "../util/logger";
import { RollbarService } from "./rollbarService";
import { traced } from "./telemetryService";

export type RateLimitedActionType =
  | "CHECK_EMAIL_TOKEN"
  | "REQUEST_EMAIL_TOKEN"
  | "ACCOUNT_RESET";

export class RateLimitService {
  private readonly context: ApplicationContext;
  private pruneTimeout: NodeJS.Timeout | undefined;
  private readonly rollbarService: RollbarService | null;
  private disabled: boolean;
  private bucketConfig: Record<
    RateLimitedActionType,
    // Define the number of actions that can occur in a time period before
    // rate-limiting begins.
    { maxActions: number; timePeriodMs: number }
  > = {
    CHECK_EMAIL_TOKEN: { maxActions: 10, timePeriodMs: ONE_HOUR_MS },
    REQUEST_EMAIL_TOKEN: { maxActions: 10, timePeriodMs: ONE_HOUR_MS },
    ACCOUNT_RESET: { maxActions: 5, timePeriodMs: ONE_DAY_MS }
  };

  public constructor(
    context: ApplicationContext,
    rollbarService: RollbarService | null,
    disabled: boolean
  ) {
    this.context = context;
    this.rollbarService = rollbarService;
    const pruneExpiredBuckets = async (): Promise<void> => {
      await this.pruneBuckets();
      this.pruneTimeout = setTimeout(() => pruneExpiredBuckets(), ONE_HOUR_MS);
    };
    pruneExpiredBuckets();
    this.removeUnsupportedBuckets();
    this.disabled = disabled;
  }

  public stop(): void {
    if (this.pruneTimeout) {
      clearTimeout(this.pruneTimeout);
    }
  }

  /**
   * Requests permission to perform a rate-limited action, returning a
   * boolean to indicate whether permission is granted. If the action is
   * permitted then the rate-limit count will be incremented.
   *
   * Rate limits apply to actions and identifiers. The limit on number of
   * actions per hour can vary per action type. Limits on actions are applied
   * to type-id pairs. For example, the REQUEST_EMAIL_TOKEN action might be
   * allowed up to 10 times per hour for a given identifier. In this case the
   * identifier would be the email address, meaning that a maximum of 10 token
   * requests per hour would be served for a given email address.
   *
   * In other cases, the identifier could be something like a user ID, IP
   * address, or other means of categorizing requests.
   *
   * @param actionType The type of action being requested permission for
   * @param actionId The unique identifier of the action being requested
   * @returns Whether or not to permit the action
   */
  public async requestRateLimitedAction(
    actionType: RateLimitedActionType,
    actionId: string
  ): Promise<boolean> {
    return traced(
      "RateLimitService",
      "requestRateLimitedAction",
      async (span) => {
        span?.setAttribute("actionType", actionType);
        span?.setAttribute("actionId", actionId);

        if (this.disabled) {
          span?.setAttribute("rateLimitCheckDisabled", true);
          return true;
        }

        const limit = this.bucketConfig[actionType];

        const result = await consumeRateLimitToken(
          this.context.dbPool,
          actionType,
          actionId,
          limit.maxActions,
          limit.timePeriodMs
        );

        // -1 indicates that the action should be declined
        const allowed = result.remaining > -1;

        if (!allowed) {
          logger(
            `[RATELIMIT] Action "${actionId}" of type "${actionType}" was rate-limited`
          );
          this.rollbarService?.reportError(
            new Error(
              `Action "${actionId}" of type "${actionType}" was rate-limited`
            )
          );
        }

        return allowed;
      }
    );
  }

  /**
   * Delete expired rate-limiting buckets from the DB.
   */
  public async pruneBuckets(): Promise<void> {
    for (const [actionType, bucketConfig] of Object.entries(
      this.bucketConfig
    )) {
      try {
        await pruneRateLimitBuckets(
          this.context.dbPool,
          actionType,
          Date.now() - bucketConfig.timePeriodMs
        );
      } catch (e) {
        logger(
          `[RATELIMIT] Error encountered when pruning expired rate limit buckets:`,
          e
        );
        this.rollbarService?.reportError(e);
      }
    }
  }

  /**
   * Delete legacy unsupported buckets;
   */
  public async removeUnsupportedBuckets(): Promise<void> {
    try {
      await deleteUnsupportedRateLimitBuckets(
        this.context.dbPool,
        Object.keys(this.bucketConfig)
      );
    } catch (e) {
      logger(
        `[RATELIMIT] Error encountered when removing unsupported rate limit buckets:`,
        e
      );
      this.rollbarService?.reportError(e);
    }
  }
}

export function startRateLimitService(
  context: ApplicationContext,
  rollbarService: RollbarService | null
): RateLimitService {
  return new RateLimitService(
    context,
    rollbarService,
    process.env.GENERIC_RATE_LIMIT_DISABLED === "true"
  );
}
