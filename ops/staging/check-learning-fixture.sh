#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
service=gravitas-workspace-staging
test "$(cat "/etc/$service/created-by")" = "$service"
db=$service-postgres
test "$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$db")" = '127.0.0.1:15432'
fixture=synthetic-staging-learning-45973547077-1
proof=$(docker exec -i "$db" psql -XqtA -U postgres -d gravitas_workspace_staging -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*)
FROM core_course c
JOIN core_courseenrollment e ON e.course_id=c.id
JOIN auth_user u ON u.id=e.user_id
JOIN core_lessonprogress p ON p.enrollment_id=e.id
WHERE c.slug='synthetic-staging-learning-45973547077-1' AND c.provider='native'
  AND u.email='synthetic-staging-learning-45973547077-1@example.test' AND NOT u.is_active
  AND p.completed AND e.status='completed' AND e.progress_percent=100;
SQL
)
test "$proof" = 1
docker exec -i "$db" psql -XqtA -U postgres -d gravitas_workspace_staging -v ON_ERROR_STOP=1 <<'SQL'
UPDATE core_course
SET status='archived', updated_at=clock_timestamp()
WHERE slug='synthetic-staging-learning-45973547077-1'
  AND title='Synthetic staging QA course' AND provider='native' AND status='published';
SQL
course=$(docker exec -i "$db" psql -XqtA -U postgres -d gravitas_workspace_staging -v ON_ERROR_STOP=1 -c \
  "SELECT id FROM core_course WHERE slug='$fixture' AND provider='native' AND status='archived'")
[[ "$course" =~ ^[0-9]+$ ]]
test "$(curl --noproxy '*' -sS --max-time 10 --resolve staging.graviquest.com:443:127.0.0.1 \
  -o /dev/null -w '%{http_code}' "https://staging.graviquest.com/api/lms/courses/$course/")" = 404
echo 'Verified 100% native staging course progress with persisted lesson completion.'
echo 'Synthetic learner remains deactivated. The exact synthetic course is archived and denied to anonymous visitors.'
