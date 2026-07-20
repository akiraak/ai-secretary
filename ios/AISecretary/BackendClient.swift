// backend API（POST /devices, GET /briefings/latest）の薄いクライアント。
// 認証は共有シークレットの Bearer（backend/src/server.ts）。
import Foundation

struct BackendClient {
    enum ClientError: LocalizedError {
        case unauthorized
        case http(Int, String?)
        case invalidResponse

        var errorDescription: String? {
            switch self {
            case .unauthorized:
                return "認証に失敗しました。共有シークレットを確認してください"
            case .http(let status, let message):
                return "サーバエラー (HTTP \(status))\(message.map { ": \($0)" } ?? "")"
            case .invalidResponse:
                return "サーバの応答が読み取れません"
            }
        }
    }

    let baseURL: URL
    let secret: String

    /// URL とシークレットが揃っていなければ nil（= 未設定）
    static func make(urlString: String, secret: String) -> BackendClient? {
        let trimmedURL = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSecret = secret.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSecret.isEmpty,
              let url = URL(string: trimmedURL),
              let scheme = url.scheme, scheme == "http" || scheme == "https"
        else { return nil }
        return BackendClient(baseURL: url, secret: trimmedSecret)
    }

    /// デバイストークンを登録する（POST /devices）
    func registerDevice(token: String) async throws {
        var request = makeRequest(path: "/devices", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["token": token, "platform": "ios"])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
    }

    /// 最新ブリーフィングを取得する（GET /briefings/latest）。まだ無ければ nil
    func fetchLatestBriefing() async throws -> LatestBriefing? {
        let request = makeRequest(path: "/briefings/latest", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
        if http.statusCode == 404 { return nil } // まだブリーフィング未生成
        try Self.ensureOK(data: data, response: response)
        return try JSONDecoder().decode(LatestBriefing.self, from: data)
    }

    /// 最新の Canvas 締切と完了状態を取得する（GET /deadlines）
    func fetchDeadlines() async throws -> DeadlinesResponse {
        let request = makeRequest(path: "/deadlines", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
        return try JSONDecoder().decode(DeadlinesResponse.self, from: data)
    }

    /// リポジトリの TODO.md へタスクを 1 行追記する（POST /todos/repo）
    func addRepoTodo(repo: String, text: String) async throws {
        struct Body: Encodable {
            let repo: String
            let text: String
        }
        var request = makeRequest(path: "/todos/repo", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(repo: repo, text: text))
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
    }

    /// 日々のタスク一覧を取得する（GET /todos/daily。未完了 + 当日完了分）
    func fetchDailyTodos() async throws -> [DailyTodoItem] {
        let request = makeRequest(path: "/todos/daily", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
        return try JSONDecoder().decode(DailyTodosResponse.self, from: data).todos
    }

    /// 日々のタスクを追加する（POST /todos/daily）。作成された 1 件を返す
    func addDailyTodo(text: String) async throws -> DailyTodoItem {
        struct Body: Encodable {
            let text: String
        }
        struct Response: Decodable {
            let todo: DailyTodoItem
        }
        var request = makeRequest(path: "/todos/daily", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(text: text))
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
        return try JSONDecoder().decode(Response.self, from: data).todo
    }

    /// 日々のタスクの完了/取り消しを更新する（POST /todos/daily/complete）
    func setDailyTodoCompleted(id: Int, completed: Bool) async throws {
        struct Body: Encodable {
            let id: Int
            let completed: Bool
        }
        var request = makeRequest(path: "/todos/daily/complete", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(id: id, completed: completed))
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
    }

    /// 締切の手動完了チェックを更新する（POST /deadlines/complete）
    func setDeadlineCompleted(uid: String, completed: Bool) async throws {
        struct Body: Encodable {
            let uid: String
            let completed: Bool
        }
        var request = makeRequest(path: "/deadlines/complete", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(uid: uid, completed: completed))
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.ensureOK(data: data, response: response)
    }

    private func makeRequest(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        return request
    }

    private static func ensureOK(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw ClientError.invalidResponse }
        guard http.statusCode != 401 else { throw ClientError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw ClientError.http(http.statusCode, message)
        }
    }
}
