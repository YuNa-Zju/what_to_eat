-- Shared voters retain a zero choice so later device imports cannot restore a
-- cancelled vote. Existing cookie votes and public counts are preserved.
CREATE TABLE votes_next (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (-1, 0, 1)),
    PRIMARY KEY (post_id, voter_id)
);
INSERT INTO votes_next(post_id,voter_id,value) SELECT post_id,voter_id,value FROM votes;
DROP TABLE votes;
ALTER TABLE votes_next RENAME TO votes;
CREATE INDEX votes_voter ON votes(voter_id);
