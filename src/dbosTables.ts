export interface workflow_status {
    workflow_uuid: string;
    status: string | null;
    name: string | null;
    authenticated_user: string | null;
    assumed_role: string | null;
    authenticated_roles: string | null;
    request: string | null;
    output: string | null;
    error: string | null;
    executor_id: string | null;
    created_at: string; // actually a bigint
    updated_at: string; // actually a bigint
    application_version: string | null;
    application_id: string | null;
    class_name: string | null;
    config_name: string | null;
    recovery_attempts: string | null; // actually a nullable bigint
    queue_name: string | null;
}
