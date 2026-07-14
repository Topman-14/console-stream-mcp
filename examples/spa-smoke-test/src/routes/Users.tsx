import { Link, useParams, useSearchParams } from "react-router-dom";

const USERS = [
  { id: "1", name: "Ada Lovelace" },
  { id: "2", name: "Grace Hopper" },
  { id: "3", name: "Alan Turing" },
];

export function UsersList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = searchParams.get("sort") ?? "id";

  return (
    <div>
      <h2>Users</h2>
      <p>
        Sort:{" "}
        <button onClick={() => setSearchParams({ sort: "id" })} disabled={sort === "id"}>
          id
        </button>{" "}
        <button onClick={() => setSearchParams({ sort: "name" })} disabled={sort === "name"}>
          name
        </button>
      </p>
      <p>Clicking a sort button changes the URL's search params (?sort=...) without a full navigation — a distinct navigation event from a route change.</p>
      <ul>
        {[...USERS]
          .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a.id.localeCompare(b.id)))
          .map((u) => (
            <li key={u.id}>
              <Link to={`/users/${u.id}`}>{u.name}</Link>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function UserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const user = USERS.find((u) => u.id === userId);

  return (
    <div>
      <h2>User detail</h2>
      <p>
        Route param <code>userId</code>: <strong>{userId}</strong>
      </p>
      {user ? <p>{user.name}</p> : <p>Unknown user — try a different id in the URL to exercise a "not found" state.</p>}
      <p>
        <Link to="/users">Back to users</Link>
      </p>
    </div>
  );
}
