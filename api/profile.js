export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id, reel_url } = req.query;

    // ==========================================
    // HEADER + COOKIE (ROTASI BUAT HINDARI LIMIT)
    // ==========================================
    const SESSIONS = [
        {
            session_id: "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw",
            ds_user_id: "65092514569",
            csrf_token: "t-YhlTgmNH1_CDj2ta4iUc"
        }
        // Tambahin akun lain di sini kalo punya (minimal 3-5 akun)
    ];

    // Pilih session secara random biar gak gampang ke-detect
    const session = SESSIONS[Math.floor(Math.random() * SESSIONS.length)];

    const baseHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    const authHeaders = {
        ...baseHeaders,
        "X-CSRFToken": session.csrf_token,
        "Cookie": `sessionid=${session.session_id}; ds_user_id=${session.ds_user_id}; csrftoken=${session.csrf_token};`
    };

    try {
        // ==========================================
        // MODE 1: DOWNLOAD REELS
        // ==========================================
        if (reel_url) {
            const reelId = extractReelId(reel_url);
            if (!reelId) throw new Error("URL Reels tidak valid");

            const reelData = await fetchWithRetry(
                () => fetchReelMedia(reelId, authHeaders),
                'reel'
            );
            return res.status(200).json({
                success: true,
                type: "reel_download",
                reel: reelData
            });
        }

        // ==========================================
        // MODE 2: LIHAT ISI HIGHLIGHT
        // ==========================================
        if (highlight_id) {
            const hMediaUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${highlight_id}`;
            const hData = await fetchWithRetry(
                async () => {
                    const resp = await fetch(hMediaUrl, { headers: authHeaders });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    return resp.json();
                },
                'highlight_detail'
            );
            
            const items = hData.reels_media[0]?.items || [];
            return res.status(200).json({
                success: true,
                type: "highlight_items",
                items: items.map(i => ({
                    id: i.id,
                    type: i.media_type === 1 ? "image" : "video",
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url
                }))
            });
        }

        // ==========================================
        // MODE 3: PROFIL LENGKAP
        // ==========================================
        if (!url) return res.status(400).json({ success: false, message: "Link mana bro?" });

        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim();
        } else {
            username = url.replace('@', '').trim();
        }
        if (!username) throw new Error("Username tidak ditemukan dari link.");

        // Ambil profil dengan retry
        console.log(`[${new Date().toISOString()}] Fetching profile: ${username}`);
        const profileData = await fetchWithRetry(
            async () => {
                const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
                const resp = await fetch(profileUrl, { headers: baseHeaders });
                
                // Deteksi rate limiting
                if (resp.status === 429) {
                    throw new Error('RATE_LIMITED');
                }
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                
                const data = await resp.json();
                if (!data?.data?.user) throw new Error('USER_NOT_FOUND');
                return data;
            },
            'profile'
        );

        const user = profileData.data.user;
        const userId = user.id;

        // Postingan (dari data profil, gak perlu request tambahan)
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

        // Story & Highlights (request terpisah dengan retry)
        console.log(`[${new Date().toISOString()}] Fetching stories & highlights for user ${userId}`);
        const [stories, highlights] = await Promise.all([
            fetchWithRetry(() => fetchStoriesWithCookie(userId, authHeaders), 'stories'),
            fetchWithRetry(() => fetchHighlightsWithCookie(userId, authHeaders), 'highlights')
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
        console.error(`[${new Date().toISOString()}] Error:`, error.message);
        
        // Kasih tau user kalo kena rate limit
        const statusCode = error.message === 'RATE_LIMITED' ? 429 : 500;
        res.status(statusCode).json({
            success: false,
            message: error.message === 'RATE_LIMITED' 
                ? "Rate limit terdeteksi, coba lagi beberapa menit lagi"
                : "Gagal menyedot data",
            error: error.message,
            retry_after: error.message === 'RATE_LIMITED' ? 300 : null // 5 menit
        });
    }
}

// ==========================================
// FUNGSI RETRY DENGAN BACKOFF (ANTI RATE LIMIT)
// ==========================================
async function fetchWithRetry(fetchFunction, context, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Jeda antar retry (exponential backoff)
            if (i > 0) {
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000; // 2s, 4s, 8s + random
                console.log(`[${context}] Retry ${i} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            return await fetchFunction();
        } catch (error) {
            // Kalo rate limited, tunggu lebih lama
            if (error.message === 'RATE_LIMITED' || error.message.includes('429')) {
                console.log(`[${context}] Rate limited, waiting 60s before retry ${i + 1}`);
                await new Promise(resolve => setTimeout(resolve, 60000)); // 1 menit
                continue;
            }
            
            // Kalo error lain & udah retry terakhir, lempar error
            if (i === maxRetries - 1) throw error;
        }
    }
}

// ==========================================
// FUNGSI BANTU LAINNYA (TETAP SAMA)
// ==========================================
function extractReelId(reelUrl) {
    try {
        const patterns = [
            /\/reel\/([a-zA-Z0-9_-]+)/,
            /\/reels\/([a-zA-Z0-9_-]+)/,
            /\/p\/([a-zA-Z0-9_-]+)/
        ];
        
        for (const pattern of patterns) {
            const match = reelUrl.match(pattern);
            if (match) return match[1];
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchReelMedia(reelId, headers) {
    const queryHash = 'b3055c01b4b222b8a47dc12b090e4e64';
    const variables = JSON.stringify({
        shortcode: reelId,
        child_comment_count: 3,
        fetch_comment_count: 40,
        parent_comment_count: 24,
        has_threaded_comments: true
    });
    
    const graphqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`;
    const resp = await fetch(graphqlUrl, { headers });
    const json = await resp.json();
    
    const media = json.data?.shortcode_media;
    if (!media) throw new Error("Reel tidak ditemukan");

    const videoUrl = media.video_url || 
                    media.video_versions?.[0]?.url || 
                    null;

    const thumbnail = media.display_url || 
                     media.image_versions2?.candidates?.[0]?.url || 
                     null;

    return {
        id: media.id,
        shortcode: media.shortcode,
        caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
        video_url: videoUrl,
        thumbnail: thumbnail,
        duration: media.video_duration || 0,
        dimensions: {
            width: media.dimensions?.width || 0,
            height: media.dimensions?.height || 0
        },
        like_count: media.edge_media_preview_like?.count || 0,
        comment_count: media.edge_media_to_comment?.count || 0,
        view_count: media.video_view_count || 0
    };
}

async function fetchStoriesWithCookie(userId, headers) {
    const url = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return [];

    const json = await resp.json();
    const reelsMedia = json.reels_media?.[0];
    if (!reelsMedia) return [];

    const items = reelsMedia.items || [];
    return items.map(item => ({
        id: item.id,
        type: item.media_type === 1 ? 'image' : 'video',
        url: item.media_type === 1 
            ? (item.image_versions2?.candidates?.[0]?.url || '')
            : (item.video_versions?.[0]?.url || ''),
        taken_at: item.taken_at_timestamp,
        expiring_at: item.expiring_at_timestamp
    }));
}

async function fetchHighlightsWithCookie(userId, headers) {
    const trayUrl = `https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`;
    const trayResp = await fetch(trayUrl, { headers });
    if (!trayResp.ok) return [];

    const trayData = await trayResp.json();
    const trayItems = trayData.tray || [];

    const highlights = await Promise.all(
        trayItems.slice(0, 10).map(async (item) => {
            try {
                const detailUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${item.id}`;
                const detailResp = await fetch(detailUrl, { headers });
                const detailData = detailResp.ok ? await detailResp.json() : null;
                const mediaItems = detailData?.reels_media?.[0]?.items || [];

                return {
                    id: item.id,
                    title: item.title,
                    cover: item.cover_media?.cropped_image_version?.url || null,
                    items: mediaItems.map(m => ({
                        id: m.id,
                        type: m.is_video ? 'video' : 'image',
                        url: m.is_video
                            ? (m.video_versions?.[0]?.url || '')
                            : (m.image_versions2?.candidates?.[0]?.url || ''),
                        taken_at: m.taken_at_timestamp
                    }))
                };
            } catch {
                return {
                    id: item.id,
                    title: item.title,
                    cover: item.cover_media?.cropped_image_version?.url || null,
                    items: []
                };
            }
        })
    );

    return highlights;
}
