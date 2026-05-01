export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ success: false, message: "Link Instagram-nya mana bro?" });
    }

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim();
        } else {
            username = url.replace('@', '').trim();
        }
        if (!username) throw new Error("Username tidak ditemukan dari link.");

        // Profil + timeline
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileResponse = await fetch(profileUrl, { headers });
        if (!profileResponse.ok) throw new Error(`IG menolak akses (Status: ${profileResponse.status})`);

        const data = await profileResponse.json();
        if (!data?.data?.user) throw new Error("Akun tidak ditemukan atau di-private sepenuhnya");

        const user = data.data.user;
        const userId = user.id;

        // Postingan
        const timelineEdges = user.edge_owner_to_timeline_media.edges || [];
        const posts = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];
            if (node.__typename === 'GraphSidecar' && node.edge_sidecar_to_children) {
                children = node.edge_sidecar_to_children.edges.map(child => {
                    const cNode = child.node;
                    return {
                        id: cNode.id,
                        type: cNode.__typename,
                        url: cNode.is_video ? cNode.video_url : cNode.display_url
                    };
                });
            }
            return {
                id: node.id,
                shortcode: node.shortcode,
                type: node.__typename,
                thumbnail: node.display_url,
                video_url: node.video_url || null,
                carousel_items: children
            };
        });

        // Story & Highlights pake GraphQL publik (no login)
        const [stories, highlights] = await Promise.all([
            fetchStoriesPublic(userId, headers),
            fetchHighlightsPublic(userId, headers)
        ]);

        res.status(200).json({
            success: true,
            extracted_username: username,
            profile: {
                id: user.id,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic_hd: user.profile_pic_url_hd,
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                total_posts: user.edge_owner_to_timeline_media.count,
                is_private: user.is_private
            },
            data: {
                posts,
                stories,
                highlights
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Gagal menyedot data",
            error: error.message
        });
    }
}

// ---------- PUBLIC STORY (GraphQL) ----------
async function fetchStoriesPublic(userId, headers) {
    try {
        // query_hash buat reel media (story)
        const queryHash = 'de8017ee0a7c9c8ec53687b6e92d52c8';
        const variables = JSON.stringify({
            reel_ids: [userId],
            precomposed_overlay: false
        });
        const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`;

        const resp = await fetch(url, { headers });
        if (!resp.ok) return [];

        const json = await resp.json();
        const reelsMedia = json.data?.reels_media?.[0];
        if (!reelsMedia) return [];

        const items = reelsMedia.items || [];
        return items.map(item => ({
            id: item.id,
            type: item.is_video ? 'video' : 'image',
            url: item.is_video
                ? (item.video_versions?.[0]?.url || '')
                : (item.image_versions2?.candidates?.[0]?.url || ''),
            taken_at: item.taken_at_timestamp,
            expiring_at: item.expiring_at_timestamp
        }));
    } catch {
        return [];
    }
}

// ---------- PUBLIC HIGHLIGHTS (GraphQL) ----------
async function fetchHighlightsPublic(userId, headers) {
    try {
        // query_hash buat highlight tray
        const queryHash = 'd4d88dc1500312af6f937f7b804c68c3';
        const variables = JSON.stringify({
            user_id: userId,
            include_chaining: false,
            include_reel: false,
            include_suggested_users: false,
            include_logged_out_extras: false,
            include_highlight_reels: true
        });
        const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`;

        const resp = await fetch(url, { headers });
        if (!resp.ok) return [];

        const json = await resp.json();
        const edgeHighlights = json.data?.user?.edge_highlight_reels?.edges || [];
        const highlights = [];
        // Maks 10 biar cepet
        const limited = edgeHighlights.slice(0, 10);

        for (const edge of limited) {
            const node = edge.node;
            // Ambil detail isi highlight (pake graphql juga)
            const detailHash = '0a85b5e1e2a5c5f16c7e6a6c5c7b3e7a'; // untuk highlight media
            const detailVars = JSON.stringify({
                reel_ids: [`highlight:${node.id}`],
                precomposed_overlay: false
            });
            const detailUrl = `https://www.instagram.com/graphql/query/?query_hash=${detailHash}&variables=${encodeURIComponent(detailVars)}`;

            const detailResp = await fetch(detailUrl, { headers });
            const detailJson = detailResp.ok ? await detailResp.json() : null;
            const mediaItems = detailJson?.data?.reels_media?.[0]?.items || [];

            highlights.push({
                id: node.id,
                title: node.title,
                cover: node.cover_media?.cropped_image_version?.url || null,
                items: mediaItems.map(m => ({
                    id: m.id,
                    type: m.is_video ? 'video' : 'image',
                    url: m.is_video
                        ? (m.video_versions?.[0]?.url || '')
                        : (m.image_versions2?.candidates?.[0]?.url || ''),
                    taken_at: m.taken_at_timestamp
                }))
            });
        }
        return highlights;
    } catch {
        return [];
    }
}
