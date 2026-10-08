"""Real PostgreSQL locking proof; production is never contacted."""
import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get('CHECKPOINT_TEST_POSTGRES') == '1', 'isolated PostgreSQL16 CI required')
class NativeAclLockTests(unittest.TestCase):
    def test_empty_acl_is_protected_against_another_connections_insert(self):
        import psycopg
        from psycopg import sql
        table = sql.Identifier('acl_lock_test_' + uuid.uuid4().hex)
        with psycopg.connect('dbname=postgres user=postgres host=localhost port=5432', autocommit=True) as first, \
             psycopg.connect('dbname=postgres user=postgres host=localhost port=5432', autocommit=True) as second:
            first.execute(sql.SQL('CREATE TABLE {} (id integer)').format(table))
            try:
                with first.transaction():
                    first.execute(sql.SQL('LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE').format(table))
                    self.assertEqual(first.execute(sql.SQL('SELECT count(*) FROM {}').format(table)).fetchone()[0], 0)
                    second.execute("SET lock_timeout = '100ms'")
                    with self.assertRaises(psycopg.errors.LockNotAvailable):
                        second.execute(sql.SQL('INSERT INTO {} VALUES (1)').format(table))
                second.execute(sql.SQL('INSERT INTO {} VALUES (1)').format(table))
                self.assertEqual(first.execute(sql.SQL('SELECT count(*) FROM {}').format(table)).fetchone()[0], 1)
            finally:
                first.execute(sql.SQL('DROP TABLE {}').format(table))


if __name__ == '__main__':
    unittest.main()
