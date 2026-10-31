class AhpHost {
  /** @internal */
  constructor(info, disposeHost, publishHostSession, listHostSessions, unpublishHostSession, updateCreationPolicy) {
    this.disposeHost = disposeHost;
    this.publishHostSession = publishHostSession;
    this.listHostSessions = listHostSessions;
    this.unpublishHostSession = unpublishHostSession;
    this.updateCreationPolicy = updateCreationPolicy;
    this.hostId = info.hostId;
    this.url = info.url;
    this.environmentId = info.environmentId;
    this.token = info.token;
    this.pid = info.pid;
  }
  disposeHost;
  publishHostSession;
  listHostSessions;
  unpublishHostSession;
  updateCreationPolicy;
  hostId;
  /** Local WebSocket URL. Absent when only the GitHub environment is enabled. */
  url;
  /** Mission Control environment ID, when GitHub hosting is enabled. */
  environmentId;
  /** Connection token, when required by the listener. Treat this value as a secret. */
  token;
  /** Legacy separate host process ID. Absent for in-process listeners; use dispose() to stop. */
  pid;
  /** Ask the runtime to stop the listener and await its cleanup, on every call. */
  dispose() {
    return this.disposeHost();
  }
  /** Change subsequent remote admissions without disconnecting clients; admitted creation may finish. */
  setAllowCreatingNewSessions(allowed) {
    return this.updateCreationPolicy(allowed);
  }
  /** Publish an attached application session into the durable compute-scoped host catalog. */
  publishSession(sessionId) {
    return this.publishHostSession(sessionId);
  }
  /**
   * Withdraw a live or dormant application publication and revoke AHP attachments.
   * Preserves local history, worktrees and ongoing work; returns false when already absent.
   * Rejects nonapplication publications. Does not stop the host.
   */
  unpublishSession(sessionId) {
    return this.unpublishHostSession(sessionId);
  }
  /** List all live and dormant catalog sessions advertised by this host. */
  listSessions() {
    return this.listHostSessions();
  }
  async [Symbol.asyncDispose]() {
    await this.dispose();
  }
}
export {
  AhpHost
};
